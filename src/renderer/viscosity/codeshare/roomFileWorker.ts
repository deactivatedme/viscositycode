import { isHomeProject } from "@/shared/homeScope";
import { z } from "zod";
import { shareFileGrantSchema } from "@/shared/codeShareFileTools";
import type { ShareRoomTurn } from "@/shared/codeShareRoom";
import { readBridge } from "@/renderer/bridge";
import { CodeShareClientError, type CodeShareConnection } from "./client";
import { readCodeShareLocalProject } from "./subscription";

const recordSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  lease: z.uuid(),
  grant: shareFileGrantSchema,
});
type FileRecord = z.infer<typeof recordSchema>;
const key = (roomId: string) => "viscosity-codeshare-room-files-v1:" + roomId;
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 850));
export function readRoomFileRecord(roomId: string): FileRecord | undefined {
  const raw = localStorage.getItem(key(roomId));
  if (!raw) return undefined;
  // Preserve unfamiliar records and refuse a new grant rather than losing an active writer.
  return recordSchema.parse(JSON.parse(raw));
}
async function drain(
  connection: CodeShareConnection,
  roomId: string,
  record: FileRecord,
): Promise<void> {
  for (;;) {
    try {
      await readBridge().closeCodeShareWorkspace(record.grant);
      break;
    } catch {
      await wait();
    }
  }
  for (;;) {
    try {
      await connection.endRoomTurn({
        id: record.id,
        lease: record.lease,
        outcome: "complete",
        reply: "",
      });
      break;
    } catch (error) {
      if (error instanceof CodeShareClientError && error.code === "room_claim") break;
      await wait();
    }
  }
  if (readRoomFileRecord(roomId)?.lease === record.lease) localStorage.removeItem(key(roomId));
}
export async function monitorRoomFiles(
  connection: CodeShareConnection,
  roomId: string,
  record: FileRecord,
): Promise<void> {
  const claim = { id: record.id, lease: record.lease };
  for (;;) {
    try {
      const state = await connection.roomFileRequests(claim);
      if (state.providerDone || state.status !== "running") break;
      for (const request of state.requests) {
        const result = await readBridge().executeCodeShareFileTool({
          ...record.grant,
          requestId: request.id,
          tool: request.tool,
        });
        await connection.roomFileResult(claim, request.id, result);
      }
    } catch (error) {
      if (error instanceof CodeShareClientError && error.code === "room_claim") break;
      // Reconnecting uses the same grant and operation IDs; a write is never replayed as a new request.
    }
    await wait();
  }
  await drain(connection, roomId, record);
}
export async function startRoomFiles(
  connection: CodeShareConnection,
  roomId: string,
  turn: ShareRoomTurn,
  expectedProjectId: string,
): Promise<void> {
  if (readRoomFileRecord(roomId)) throw new CodeShareClientError("room_claim");
  const project = readCodeShareLocalProject();
  if (isHomeProject(project) || project.id !== expectedProjectId)
    throw new CodeShareClientError("local_project_required");
  const grant = {
    projectLocation: project.location,
    ...(await readBridge().openCodeShareWorkspace({ projectLocation: project.location })),
  };
  const record: FileRecord = { version: 1, id: turn.id, lease: crypto.randomUUID(), grant };
  try {
    localStorage.setItem(key(roomId), JSON.stringify(record));
  } catch (error) {
    await readBridge().closeCodeShareWorkspace(grant);
    throw error;
  }
  try {
    const receipt = await connection.claimRoomTurn({ id: record.id, lease: record.lease });
    if (
      receipt.execution !== "owner" ||
      receipt.model !== turn.model ||
      receipt.prompt !== turn.prompt ||
      receipt.id !== turn.id
    )
      throw new CodeShareClientError("room_claim");
  } catch (error) {
    await drain(connection, roomId, record);
    throw error;
  }
  await monitorRoomFiles(connection, roomId, record);
}
