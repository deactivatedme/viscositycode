import { describe, expect, it, vi } from "vitest";
import {
  agentStatusesResponseSchema,
  DEFAULT_SCHEDULE_AUTOMATION,
  emptyMcpLaunchSnapshot,
  type Project,
  type RuntimeEvent,
  type ScheduledTask,
  type ScheduledTaskRun,
  type StartThreadPayload,
  type Thread,
  type ThreadStatus,
} from "@/shared/contracts";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import type { SupervisorEvent } from "@/shared/ipc";
import { defaultSharedSettings } from "@/shared/settings";
import {
  ScheduleRunCoordinator,
  type ScheduleRunCoordinatorDeps,
} from "@/host/schedules/ScheduleRunCoordinator";
import { AccountPoolFailoverService } from "./AccountPoolFailoverService";
import { sharesEnabledAccountPool } from "./failoverPolicy";

const HOME: Project = {
  id: "home",
  name: "Home",
  location: { kind: "posix", path: "/synthetic/home" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const POOLS = { codex: { enabled: true, members: ["codex", "codex:work"] } };

const task: ScheduledTask = {
  id: "schedule-1",
  name: "Nightly brief",
  prompt: "Summarize the day.",
  agentKind: "codex",
  config: { model: "model-a" },
  recurrence: { kind: "hourly", minute: 0 },
  enabled: true,
  nextRunAt: null,
  lastRunAt: null,
  lastCompletedAt: null,
  lastStatus: "never",
  lastResult: null,
  lastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const statuses = agentStatusesResponseSchema.parse({
  fromCache: true,
  windows: ["codex", "codex:work"].map((kind) => ({
    kind,
    label: kind === "codex" ? "Codex" : "Codex Work",
    installed: true,
    authState: "authenticated",
    capabilities: {
      presentationMode: "gui",
      models: [{ id: "model-a", label: "Model A" }],
    },
  })),
  wsl: [],
});

function state(
  threadId: string,
  status: ThreadStatus,
  agentKind?: string,
  errorMessage?: string,
): SupervisorEvent {
  return {
    type: "thread-state",
    threadId,
    status,
    attention: "none",
    canResumeWithConfig: false,
    ...(agentKind ? { agentKind } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function makeHarness(
  options: {
    switchThread?: (payload: StartThreadPayload & { threadId: string }) => Promise<unknown>;
    members?: string[];
    coordinator?: Partial<ScheduleRunCoordinatorDeps>;
  } = {},
) {
  const threads = new Map<string, Thread>();
  const runs = new Map<string, ScheduledTaskRun>();
  const ids = ["thread-1", "run-1"];
  let idx = 0;
  const switches: string[] = [];
  const pools = options.members ? { codex: { enabled: true, members: options.members } } : POOLS;
  const startThread = vi
    .fn<(payload: StartThreadPayload) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  const coordinator = new ScheduleRunCoordinator({
    startThread,
    sendThreadInput: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    interruptThread: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getAgentStatuses: async () => statuses,
    admitScheduleExecution: () => {},
    getThreadRuntimeItemCursor: () => -1,
    getThreadRuntimeItemsAfter: () => [],
    sendThreadCommand: () => true,
    ensureHomeProject: () => HOME,
    getProject: (id) => (id === HOME.id ? HOME : null),
    upsertThread: (thread) => {
      threads.set(thread.id, thread);
    },
    deleteThread: (id) => {
      threads.delete(id);
    },
    threadExists: (id) => threads.has(id),
    getThread: (id) => threads.get(id) ?? null,
    insertRun: (run) => {
      runs.set(run.id, run);
    },
    updateRun: (id, patch) => {
      const current = runs.get(id);
      if (!current) return;
      runs.set(id, {
        ...current,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      });
    },
    newId: () => ids[idx++] ?? `id-${idx}`,
    getSharedSettings: () => defaultSharedSettings,
    sharesAccountPool: (a, b) => sharesEnabledAccountPool(pools, a, b),
    // Same wiring as BackendDurableServices (the service is created just below).
    mayAccountFailover: (threadId) => service.mayFailOver(threadId),
    accountFailoverGraceMs: 50,
    preferredPoolAccount: (agentKind, location) => service.preferredAccount(agentKind, location),
    ...options.coordinator,
  });
  const service = new AccountPoolFailoverService({
    getAccountPools: () => pools,
    getThread: (id) => threads.get(id) ?? null,
    getProject: (id) => (id === HOME.id ? HOME : null),
    getAgentStatuses: async () => statuses,
    resolveMcpLaunchSnapshot: () => emptyMcpLaunchSnapshot(),
    switchThread:
      options.switchThread ??
      (async (payload) => {
        switches.push(payload.agentKind);
        const current = threads.get(payload.threadId);
        if (current) threads.set(payload.threadId, { ...current, agentKind: payload.agentKind });
        return { threadId: payload.threadId };
      }),
    publishNotice: () => {},
    onFailoverPending: (threadId) => coordinator.holdForAccountFailover(threadId),
    onFailoverSettled: (threadId, outcome) => coordinator.releaseAccountFailover(threadId, outcome),
    settleTimeoutMs: 20,
  });
  /** Same order as BackendDurableServices: the failover observes before schedules. */
  const emit = (event: SupervisorEvent) => {
    service.observeSupervisorEvent(event);
    coordinator.observeSupervisorEvent(event);
  };
  return { coordinator, service, threads, runs, switches, emit, startThread };
}

function runtime(event: RuntimeEvent): SupervisorEvent {
  return { type: "thread-runtime-event", threadId: event.threadId, event };
}

function startTurn(
  emit: (event: SupervisorEvent) => void,
  threadId: string,
  turnId: string,
  agentKind: string,
): void {
  emit(runtime({ type: "turn.started", threadId, turnId }));
  emit(
    runtime({
      type: "item.started",
      threadId,
      itemId: `user-${turnId}`,
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: task.prompt }] },
    }),
  );
  emit(state(threadId, "working", agentKind));
}

function failTurn(emit: (event: SupervisorEvent) => void, threadId: string, turnId: string): void {
  emit({
    type: "thread-runtime-events",
    threadId,
    events: [
      { type: "error", threadId, message: "Usage limit reached.", reason: "usage_limited" },
      { type: "turn.completed", threadId, turnId, state: "failed" },
    ],
  });
  emit(state(threadId, "error"));
}

async function started(threads: Map<string, Thread>): Promise<string> {
  await vi.waitFor(() => expect(threads.size).toBe(1));
  return [...threads.keys()][0]!;
}

describe("scheduled runs and account failover", () => {
  it("keeps the run open across a failover and records the re-sent turn's result", async () => {
    const h = makeHarness();
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    startTurn(h.emit, threadId, "turn-1", "codex");
    failTurn(h.emit, threadId, "turn-1");
    // The old session closes while the account fails over.
    h.emit({ type: "thread-exited", threadId, exitCode: null });
    await vi.waitFor(() => expect(h.switches).toEqual(["codex:work"]));
    expect(h.runs.get("run-1")?.status).toBe("running");

    // The supervisor runs the re-sent prompt on the next account.
    startTurn(h.emit, threadId, "turn-2", "codex:work");
    h.emit(runtime({ type: "turn.completed", threadId, turnId: "turn-2", state: "completed" }));
    await expect(completion).resolves.toMatchObject({ status: "succeeded", error: null });
  });

  it("fails the run with the pool message when every account is out", async () => {
    const h = makeHarness();
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    startTurn(h.emit, threadId, "turn-1", "codex");
    failTurn(h.emit, threadId, "turn-1");
    await vi.waitFor(() => expect(h.switches).toEqual(["codex:work"]));
    startTurn(h.emit, threadId, "turn-2", "codex:work");
    failTurn(h.emit, threadId, "turn-2");
    await expect(completion).resolves.toMatchObject({
      status: "failed",
      error: "All Codex accounts in your pool are out of usage.",
    });
    expect(h.switches).toEqual(["codex:work"]);
  });

  it("fails the run when the switch itself fails", async () => {
    const h = makeHarness({
      switchThread: async () => {
        throw new Error("could not start");
      },
    });
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    startTurn(h.emit, threadId, "turn-1", "codex");
    failTurn(h.emit, threadId, "turn-1");
    await expect(completion).resolves.toMatchObject({
      status: "failed",
      error:
        "Codex is out of usage, but “Nightly brief” could not move to Codex Work: could not start",
    });
  });

  it("settles normally when no pool applies", async () => {
    const h = makeHarness({ members: ["codex"] });
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    startTurn(h.emit, threadId, "turn-1", "codex");
    failTurn(h.emit, threadId, "turn-1");
    await expect(completion).resolves.toMatchObject({
      status: "failed",
      error: "Usage limit reached.",
    });
  });

  it("keeps the run open when the error state arrives before the provider's usage error", async () => {
    const h = makeHarness();
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    startTurn(h.emit, threadId, "turn-1", "codex");
    // ACP prompt rejections (Gemini, Devin, …) publish the error state first.
    h.emit(state(threadId, "error", "codex", "Quota exceeded."));
    h.emit({
      type: "thread-runtime-events",
      threadId,
      events: [
        { type: "error", threadId, message: "Quota exceeded.", reason: "usage_limited" },
        { type: "turn.completed", threadId, turnId: "turn-1", state: "failed" },
      ],
    });
    await vi.waitFor(() => expect(h.switches).toEqual(["codex:work"]));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(h.runs.get("run-1")?.status).toBe("running");

    startTurn(h.emit, threadId, "turn-2", "codex:work");
    h.emit(runtime({ type: "turn.completed", threadId, turnId: "turn-2", state: "completed" }));
    await expect(completion).resolves.toMatchObject({ status: "succeeded", error: null });
  });

  it("settles a pooled thread's other failures with the first failure, after the grace", async () => {
    const h = makeHarness();
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    startTurn(h.emit, threadId, "turn-1", "codex");
    h.emit(state(threadId, "error", "codex", "Tool crashed."));
    h.emit({
      type: "thread-runtime-events",
      threadId,
      events: [
        { type: "error", threadId, message: "Tool crashed (details)." },
        { type: "turn.completed", threadId, turnId: "turn-1", state: "failed" },
      ],
    });
    // A later idle state does not turn the failure into a success.
    h.emit(state(threadId, "idle", "codex"));
    await expect(completion).resolves.toMatchObject({ status: "failed", error: "Tool crashed." });
    expect(h.switches).toEqual([]);
  });

  it("starts a fresh run on the pooled account with the most usage left", async () => {
    const h = makeHarness();
    const usage = (providerId: string, usedPercent: number): UsageSnapshot => ({
      providerId,
      status: "ok",
      fetchedAt: Date.now(),
      windows: [{ id: "5h", label: "5h", usedPercent, resetsAt: Date.now() + 3_600_000 }],
    });
    h.emit({ type: "provider-usage", snapshot: usage("codex", 100) });
    h.emit({ type: "provider-usage", snapshot: usage("codex:work", 20) });
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    expect(h.threads.get(threadId)?.agentKind).toBe("codex:work");
    await vi.waitFor(() =>
      expect(h.startThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId, agentKind: "codex:work" }),
      ),
    );
    startTurn(h.emit, threadId, "turn-1", "codex:work");
    h.emit(runtime({ type: "turn.completed", threadId, turnId: "turn-1", state: "completed" }));
    await expect(completion).resolves.toMatchObject({ status: "succeeded" });
  });

  it("keeps the task's own account when usage gives no reason to move", async () => {
    const h = makeHarness();
    const completion = h.coordinator.runScheduleAsThread(task);
    const threadId = await started(h.threads);
    expect(h.threads.get(threadId)?.agentKind).toBe("codex");
    startTurn(h.emit, threadId, "turn-1", "codex");
    h.emit(runtime({ type: "turn.completed", threadId, turnId: "turn-1", state: "completed" }));
    await expect(completion).resolves.toMatchObject({ status: "succeeded" });
  });

  it("accepts a heartbeat target that a failover moved to a pool sibling", async () => {
    const sendThreadInput = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const h = makeHarness({ coordinator: { sendThreadInput } });
    h.threads.set("target", {
      id: "target",
      projectId: HOME.id,
      title: "Ongoing",
      agentKind: "codex:work",
      config: { model: "model-a" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const completion = h.coordinator.runScheduleAsThread({
      ...task,
      automation: {
        ...DEFAULT_SCHEDULE_AUTOMATION,
        mode: { kind: "heartbeat", targetThreadId: "target" },
      },
    });
    await vi.waitFor(() => expect(sendThreadInput).toHaveBeenCalledOnce());
    h.emit(state("target", "working", "codex:work"));
    h.emit(state("target", "idle", "codex:work"));
    await expect(completion).resolves.toMatchObject({ status: "succeeded" });
  });
});
