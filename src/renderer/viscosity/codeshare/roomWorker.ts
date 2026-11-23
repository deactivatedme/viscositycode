import { readRoomFileRecord, monitorRoomFiles, startRoomFiles } from "./roomFileWorker";
import { z } from "zod";
import { MAX_REPLY_CHARS, parseModel } from "@/shared/codeShare";
import type { RoomClaim, RoomFinish, ShareRoomRef, ShareRoomTurn } from "@/shared/codeShareRoom";
import { DEFAULT_TERMINAL_SIZE, isThreadTurnActive } from "@/shared/contracts";
import {
  markThreadLaunchFailed,
  performInitialThreadLaunch,
} from "@/renderer/actions/threadLaunchActions";
import { isRemoteCommandOutcomeUncertainError } from "@/renderer/actions/threadCommandOutcomeActions";
import { useAppStore } from "@/renderer/state/appStore";
import { entityHost } from "@/renderer/state/entityHost";
import { createLiveThreadEnginePort } from "@/renderer/viscosity/roundtable/engine/threadPortLive";
import { CodeShareClientError, type CodeShareConnection } from "./client";
import { verifyCodeShareLocalModel } from "./subscription";

const recordSchema = z.strictObject({
  id: z.uuid(),
  lease: z.uuid(),
  threadId: z.string().nullable(),
});
type RunRecord = z.output<typeof recordSchema>;
const workers = new Map<string, Promise<void>>();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function recordKey(roomId: string): string {
  return "viscosity-codeshare-room-run-v1:" + roomId;
}

function readRecord(roomId: string): RunRecord | undefined {
  try {
    const value = localStorage.getItem(recordKey(roomId));
    return value ? recordSchema.parse(JSON.parse(value)) : undefined;
  } catch {
    return undefined;
  }
}

function clearRecord(roomId: string, lease: string): void {
  if (readRecord(roomId)?.lease === lease) localStorage.removeItem(recordKey(roomId));
}

function claimOf(record: RunRecord): RoomClaim {
  return { id: record.id, lease: record.lease };
}

async function report(connection: CodeShareConnection, roomId: string, finished: RoomFinish) {
  for (;;) {
    try {
      await connection.endRoomTurn(finished);
      clearRecord(roomId, finished.lease);
      return;
    } catch (error) {
      if (error instanceof CodeShareClientError && error.code === "room_claim") {
        clearRecord(roomId, finished.lease);
        return;
      }
      await wait(2_000);
    }
  }
}

async function monitor(connection: CodeShareConnection, roomId: string, record: RunRecord) {
  const identity = claimOf(record);
  if (!record.threadId) {
    await report(connection, roomId, { ...identity, outcome: "cancelled", reply: "" });
    return;
  }
  const threadId = record.threadId;
  const driver = createLiveThreadEnginePort();
  const release = driver.retainReader(threadId);
  let observedWorking = false;
  let stopping = false;
  let idleSince = 0;
  let lastInterrupt = 0;
  let lastPublished = "";
  try {
    for (;;) {
      try {
        const currentText = driver.readLiveText(threadId).slice(0, MAX_REPLY_CHARS);
        const state = await connection.roomLeaseStatus(
          identity,
          currentText === lastPublished ? undefined : currentText,
        );
        lastPublished = currentText;
        if (state === "stopping") stopping = true;
      } catch {
        // A reconnect never reclaims or re-launches the already running thread.
      }
      const snapshot = driver.snapshot(threadId);
      const working =
        snapshot && (isThreadTurnActive(snapshot.status) || snapshot.busyInBackground);
      if (working) {
        observedWorking = true;
        idleSince = 0;
        if (stopping && performance.now() - lastInterrupt > 1_500) {
          lastInterrupt = performance.now();
          await driver.interrupt(threadId).catch(() => undefined);
        }
      } else if (snapshot) {
        idleSince ||= performance.now();
        if (performance.now() - idleSince >= 800) {
          const answer = await driver.readLastTurn(threadId);
          const failed =
            snapshot.status === "error" ||
            snapshot.interruptedTurn !== undefined ||
            Boolean(answer.errorMessage);
          if (stopping || observedWorking || failed || answer.text.trim()) {
            await report(connection, roomId, {
              ...identity,
              outcome: stopping ? "cancelled" : failed ? "failed" : "complete",
              reply: stopping || failed ? "" : answer.text.slice(0, MAX_REPLY_CHARS),
            });
            return;
          }
        }
      }
      await wait(850);
    }
  } finally {
    release();
  }
}

function track(roomId: string, work: () => Promise<void>): Promise<void> {
  const running = workers.get(roomId);
  if (running) return running;
  const result = Promise.resolve()
    .then(work)
    .finally(() => {
      if (workers.get(roomId) === result) workers.delete(roomId);
    });
  workers.set(roomId, result);
  return result;
}

export function resumeCodeShareRoomTurn(connection: CodeShareConnection, roomId: string): void {
  let files;
  try {
    files = readRoomFileRecord(roomId);
  } catch {
    return;
  }
  if (files) {
    void track(roomId, () =>
      navigator.locks
        ? navigator.locks.request(recordKey(roomId), { ifAvailable: true }, (lock) =>
            lock ? monitorRoomFiles(connection, roomId, files) : Promise.resolve(),
          )
        : monitorRoomFiles(connection, roomId, files),
    ).catch(() => {});
    return;
  }
  const record = readRecord(roomId);
  if (record) void track(roomId, () => monitor(connection, roomId, record)).catch(() => {});
}

export async function runCodeShareRoomTurn(
  connection: CodeShareConnection,
  room: ShareRoomRef,
  turn: ShareRoomTurn,
  expectedProjectId: string,
): Promise<void> {
  const roomId = room.id;
  if (workers.has(roomId) || readRecord(roomId) || readRoomFileRecord(roomId))
    throw new CodeShareClientError("room_claim");
  async function work() {
    if (readRecord(roomId)) throw new CodeShareClientError("room_claim");
    if (turn.execution === "owner")
      return startRoomFiles(connection, roomId, turn, expectedProjectId);
    const model = parseModel(turn.model);
    const { kind, project } = await verifyCodeShareLocalModel(model.provider, model.model);
    if (project.id !== expectedProjectId) throw new CodeShareClientError("local_project_required");
    const hostThreadId = crypto.randomUUID();
    const identity = entityHost(project)?.projectThreadRow(hostThreadId) ?? {
      threadId: hostThreadId,
    };
    const record: RunRecord = { id: turn.id, lease: crypto.randomUUID(), threadId: null };
    localStorage.setItem(recordKey(roomId), JSON.stringify(record));
    let receipt;
    try {
      receipt = await connection.claimRoomTurn(claimOf(record));
    } catch (error) {
      // The host may have accepted the lease even if its response was lost.
      await report(connection, roomId, { ...claimOf(record), outcome: "cancelled", reply: "" });
      throw error;
    }
    if (receipt.id !== turn.id || receipt.model !== turn.model || receipt.prompt !== turn.prompt) {
      await report(connection, roomId, { ...claimOf(record), outcome: "failed", reply: "" });
      throw new CodeShareClientError("room_claim");
    }
    const prompt = receipt.history.length
      ? JSON.stringify({ previousSharedMessages: receipt.history, request: receipt.prompt })
      : receipt.prompt;
    const thread = useAppStore.getState().createThread({
      ...identity,
      projectId: project.id,
      agentKind: kind,
      config: { model: model.model },
      prompt,
      title: turn.authorName + " · " + turn.prompt.slice(0, 72),
      presentationMode: "gui",
      focus: false,
      groupId: room.id,
      groupName: room.label,
    });
    record.threadId = thread.id;
    try {
      localStorage.setItem(recordKey(roomId), JSON.stringify(record));
      await performInitialThreadLaunch({
        thread,
        projectLocation: project.location,
        prompt,
        initialSize: DEFAULT_TERMINAL_SIZE,
      });
    } catch (error) {
      if (!isRemoteCommandOutcomeUncertainError(error)) {
        markThreadLaunchFailed(thread.id, error);
        await report(connection, roomId, { ...claimOf(record), outcome: "failed", reply: "" });
        throw error;
      }
    }
    await monitor(connection, roomId, record);
  }
  await track(roomId, () =>
    navigator.locks
      ? navigator.locks.request(recordKey(roomId), { ifAvailable: true }, (lock) => {
          if (!lock) throw new CodeShareClientError("room_claim");
          return work();
        })
      : work(),
  );
}

export function readCodeShareRoomThreadId(roomId: string): string | undefined {
  return readRecord(roomId)?.threadId ?? undefined;
}
