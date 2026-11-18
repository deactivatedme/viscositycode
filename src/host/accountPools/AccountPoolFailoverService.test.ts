import { describe, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import type { AccountPools } from "@/shared/accountPools";
import {
  agentStatusesResponseSchema,
  emptyMcpLaunchSnapshot,
  type Project,
  type RuntimeEvent,
  type StartThreadPayload,
  type Thread,
  type ThreadStatus,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type { AccountPoolNotice } from "./accountPoolNotices";
import {
  AccountPoolFailoverService,
  type AccountFailoverOutcome,
  type AccountPoolFailoverDeps,
} from "./AccountPoolFailoverService";

const NOW = 1_800_000_000_000;
const PROJECT: Project = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix", path: "/synthetic/repo" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const CAPABILITIES = {
  presentationMode: "gui",
  presentationModes: ["gui", "terminal"],
  models: [{ id: "model-a", label: "Model A" }],
  efforts: ["medium"],
  defaultEffort: "medium",
};

function agent(kind: string, label: string, authState = "authenticated") {
  return { kind, label, installed: true, authState, capabilities: CAPABILITIES };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: PROJECT.id,
    title: "Fix the build",
    agentKind: "codex",
    config: { model: "model-a", effort: "medium" },
    status: "working",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function exhausted(providerId: string, resetsAt: number): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    fetchedAt: NOW,
    windows: [{ id: "5h", label: "5h", usedPercent: 100, resetsAt }],
  };
}

interface Harness {
  service: AccountPoolFailoverService;
  threads: Map<string, Thread>;
  pools: AccountPools;
  switches: (StartThreadPayload & { threadId: string })[];
  notices: AccountPoolNotice[];
  pending: string[];
  settled: [string, AccountFailoverOutcome][];
  emit(event: SupervisorEvent): void;
}

function makeHarness(
  options: {
    members?: string[];
    enabled?: boolean;
    thread?: Partial<Thread>;
    agents?: ReturnType<typeof agent>[];
    usage?: UsageSnapshot[];
    overrides?: Partial<AccountPoolFailoverDeps>;
  } = {},
): Harness {
  const members = options.members ?? ["codex", "codex:work", "codex:home"];
  const pools: AccountPools = { codex: { enabled: options.enabled ?? true, members } };
  const threads = new Map<string, Thread>([["thread-1", thread(options.thread)]]);
  const switches: Harness["switches"] = [];
  const notices: AccountPoolNotice[] = [];
  const pending: string[] = [];
  const settled: Harness["settled"] = [];
  const statuses = agentStatusesResponseSchema.parse({
    fromCache: true,
    windows: options.agents ?? [
      agent("codex", "Codex"),
      agent("codex:work", "Codex Work"),
      agent("codex:home", "Codex Home"),
    ],
    wsl: [],
  });
  const service = new AccountPoolFailoverService({
    getAccountPools: () => pools,
    getThread: (id) => threads.get(id) ?? null,
    getProject: (id) => (id === PROJECT.id ? PROJECT : null),
    getAgentStatuses: async () => statuses,
    getUsageSnapshots: async () => options.usage ?? [],
    resolveMcpLaunchSnapshot: () => emptyMcpLaunchSnapshot(),
    switchThread: async (payload) => {
      switches.push(payload);
      const current = threads.get(payload.threadId);
      if (current) {
        threads.set(payload.threadId, {
          ...current,
          agentKind: payload.agentKind,
          config: payload.config,
        });
      }
      return { threadId: payload.threadId };
    },
    publishNotice: (notice) => {
      notices.push(notice);
    },
    onFailoverPending: (threadId) => pending.push(threadId),
    onFailoverSettled: (threadId, outcome) => settled.push([threadId, outcome]),
    now: () => NOW,
    formatResetTime: (ms) => `at ${ms - NOW}ms`,
    settleTimeoutMs: 20,
    ...options.overrides,
  });
  return {
    service,
    threads,
    pools,
    switches,
    notices,
    pending,
    settled,
    emit: (event) => service.observeSupervisorEvent(event),
  };
}

function runtime(event: RuntimeEvent): SupervisorEvent {
  return { type: "thread-runtime-event", threadId: event.threadId, event };
}

function state(status: ThreadStatus, threadId = "thread-1", agentKind?: string): SupervisorEvent {
  return {
    type: "thread-state",
    threadId,
    status,
    attention: "none",
    canResumeWithConfig: false,
    ...(agentKind ? { agentKind } : {}),
  };
}

function startTurn(h: Harness, turnId: string, text: string, threadId = "thread-1"): void {
  h.emit(runtime({ type: "turn.started", threadId, turnId }));
  h.emit(
    runtime({
      type: "item.started",
      threadId,
      itemId: `user-${turnId}`,
      itemType: "user_message",
      payload: { content: [{ kind: "text", text }] },
    }),
  );
  h.emit(state("working", threadId));
}

/** The provider reports the account ran out, then the turn and session settle. */
function failTurn(h: Harness, turnId: string, reason?: string, threadId = "thread-1"): void {
  h.emit({
    type: "thread-runtime-events",
    threadId,
    events: [
      {
        type: "error",
        threadId,
        message: "You've hit your usage limit.",
        ...(reason ? { reason } : {}),
      },
      { type: "turn.completed", threadId, turnId, state: "failed" },
    ],
  });
  h.emit(state("error", threadId));
}

async function settle(h: Harness, count: number): Promise<void> {
  await vi.waitFor(() => expect(h.settled).toHaveLength(count));
}

describe("AccountPoolFailoverService", () => {
  it("switches a usage-limited chat thread once and re-sends the interrupted prompt", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Fix the build");
    failTurn(h, "turn-1", "usage_limited");
    // Held synchronously, before later observers see the failure.
    expect(h.pending).toEqual(["thread-1"]);
    await settle(h, 1);

    expect(h.switches).toHaveLength(1);
    expect(h.switches[0]).toMatchObject({
      threadId: "thread-1",
      agentKind: "codex:work",
      prompt: "Fix the build",
      presentationMode: "gui",
      projectLocation: PROJECT.location,
      config: { model: "model-a", effort: "medium" },
      providerSwitch: { fromAgentKind: "codex", contextStrategy: "thread-transcript" },
    });
    expect(h.settled).toEqual([["thread-1", { kind: "continued" }]]);
    expect(h.notices).toEqual([
      expect.objectContaining({
        kind: "switched",
        threadId: "thread-1",
        title: "Switched to Codex Work",
      }),
    ]);

    // Stragglers from the failed turn never start a second switch.
    h.emit(state("error"));
    h.emit(
      runtime({ type: "error", threadId: "thread-1", message: "late", reason: "usage_limited" }),
    );
    await Promise.resolve();
    expect(h.switches).toHaveLength(1);
    expect(h.service.triedAccounts("thread-1")).toEqual(["codex", "codex:work"]);
  });

  it("never ping-pongs: each account is tried once and the chain stops", async () => {
    const h = makeHarness({ members: ["codex", "codex:work"] });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    expect(h.switches.map((payload) => payload.agentKind)).toEqual(["codex:work"]);

    // The re-sent turn on the second account runs out too.
    startTurn(h, "turn-2", "Ship it");
    failTurn(h, "turn-2", "usage_limited");
    await settle(h, 2);

    expect(h.switches.map((payload) => payload.agentKind)).toEqual(["codex:work"]);
    expect(h.threads.get("thread-1")?.agentKind).toBe("codex:work");
    expect(h.settled[1]).toEqual([
      "thread-1",
      { kind: "failed", error: "All Codex accounts in your pool are out of usage." },
    ]);
    expect(h.notices.map((notice) => notice.kind)).toEqual(["switched", "exhausted"]);
  });

  it("leaves the thread in error with one clear message when every account is out", async () => {
    const h = makeHarness({
      usage: [exhausted("codex:work", NOW + 3_600_000), exhausted("codex:home", NOW + 600_000)],
    });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);

    expect(h.switches).toEqual([]);
    const message = "All Codex accounts in your pool are out of usage until at 600000ms.";
    expect(h.settled).toEqual([["thread-1", { kind: "failed", error: message }]]);
    expect(h.notices).toEqual([
      {
        kind: "exhausted",
        threadId: "thread-1",
        title: "Codex accounts are out of usage",
        body: message,
      },
    ]);
    // The chain is closed: nothing stays pending for the thread.
    expect(h.service.triedAccounts("thread-1")).toEqual([]);
  });

  it("skips signed-out members and says they need sign-in", async () => {
    const h = makeHarness({
      members: ["codex", "codex:work"],
      agents: [agent("codex", "Codex"), agent("codex:work", "Codex Work", "missing")],
    });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    expect(h.switches).toEqual([]);
    expect(h.notices[0]?.body).toBe(
      "All Codex accounts in your pool are out of usage. 1 more need sign-in before they can take over.",
    );
  });

  it("uses an exhausted usage snapshot when the provider gives no reason", async () => {
    const h = makeHarness();
    h.emit({ type: "provider-usage", snapshot: exhausted("codex", NOW + 60_000) });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1");
    await settle(h, 1);
    expect(h.switches.map((payload) => payload.agentKind)).toEqual(["codex:work"]);
  });

  it("fails over from a status-only error when the account's snapshot is exhausted", async () => {
    const h = makeHarness();
    h.emit({ type: "provider-usage-all", snapshots: [exhausted("codex", NOW + 60_000)] });
    startTurn(h, "turn-1", "Ship it");
    h.emit(state("error"));
    await settle(h, 1);
    expect(h.switches.map((payload) => payload.agentKind)).toEqual(["codex:work"]);
  });

  it("leaves unrelated errors and sign-in problems to the user", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1");
    startTurn(h, "turn-2", "Ship it");
    h.emit({ type: "provider-usage", snapshot: exhausted("codex", NOW + 60_000) });
    failTurn(h, "turn-2", "auth_required");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.pending).toEqual([]);
    expect(h.switches).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it("does nothing when the pool is disabled or the account is not a member", async () => {
    const disabled = makeHarness({ enabled: false });
    startTurn(disabled, "turn-1", "Ship it");
    failTurn(disabled, "turn-1", "usage_limited");
    const outsider = makeHarness({ thread: { agentKind: "codex:other" } });
    startTurn(outsider, "turn-1", "Ship it");
    failTurn(outsider, "turn-1", "usage_limited");
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const h of [disabled, outsider]) {
      expect(h.pending).toEqual([]);
      expect(h.switches).toEqual([]);
      expect(h.notices).toEqual([]);
    }
  });

  it("never switches a terminal thread in place and suggests Continue in provider once", async () => {
    const h = makeHarness({ thread: { presentationMode: "terminal" } });
    h.emit({ type: "provider-usage", snapshot: exhausted("codex", NOW + 60_000) });
    h.emit(state("working"));
    h.emit(state("error"));
    h.emit(state("error"));
    await vi.waitFor(() => expect(h.notices).toHaveLength(1));
    expect(h.pending).toEqual([]);
    expect(h.switches).toEqual([]);
    expect(h.notices[0]).toMatchObject({
      kind: "terminal",
      title: "Codex is out of usage",
      body: "Terminal threads can't switch accounts in place. Use Continue in provider to move “Fix the build” to Codex Work.",
    });
  });

  it("starts a new chain after a turn on the new account completes", async () => {
    const h = makeHarness({
      members: ["codex", "codex:work"],
      overrides: { exhaustedCooldownMs: 0 },
    });
    startTurn(h, "turn-1", "First");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    startTurn(h, "turn-2", "First");
    h.emit(
      runtime({
        type: "turn.completed",
        threadId: "thread-1",
        turnId: "turn-2",
        state: "completed",
      }),
    );
    h.emit(state("idle"));
    expect(h.service.triedAccounts("thread-1")).toEqual([]);

    startTurn(h, "turn-3", "Second");
    failTurn(h, "turn-3", "usage_limited");
    await settle(h, 2);
    expect(h.switches.map((payload) => payload.agentKind)).toEqual(["codex:work", "codex"]);
    expect(h.switches[1]?.prompt).toBe("Second");
  });

  it("ignores a late state from the account the thread left", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    startTurn(h, "turn-2", "Ship it");
    h.emit({ type: "provider-usage", snapshot: exhausted("codex:work", NOW + 60_000) });
    // The torn-down session's final state names its own provider.
    h.emit(state("error", "thread-1", "codex"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.switches).toHaveLength(1);
    expect(h.pending).toEqual(["thread-1"]);
  });

  it("ends the chain when the owner moves the thread to another provider", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    const moved = h.threads.get("thread-1")!;
    h.threads.set("thread-1", { ...moved, agentKind: "claude" });
    h.emit(state("working", "thread-1", "claude"));
    expect(h.service.triedAccounts("thread-1")).toEqual([]);
  });

  it("stands down when the user already started a new turn", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Ship it");
    h.emit(
      runtime({ type: "error", threadId: "thread-1", message: "limit", reason: "usage_limited" }),
    );
    // The user re-sends before the failed session settled.
    startTurn(h, "turn-2", "Ship it again");
    await settle(h, 1);
    expect(h.switches).toEqual([]);
    expect(h.settled).toEqual([["thread-1", { kind: "continued" }]]);
  });

  it("reports a failed switch and stops", async () => {
    const h = makeHarness({
      overrides: {
        switchThread: async () => {
          throw new Error("The provider could not start.\nDetails follow");
        },
      },
    });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    const message =
      "Codex is out of usage, but “Fix the build” could not move to Codex Work: The provider could not start. Details follow";
    expect(h.settled).toEqual([["thread-1", { kind: "failed", error: message }]]);
    expect(h.notices).toEqual([
      {
        kind: "switch-failed",
        threadId: "thread-1",
        title: "Couldn't switch accounts",
        body: message,
      },
    ]);
    expect(h.service.triedAccounts("thread-1")).toEqual([]);
  });

  it("skips an account another thread just found out of usage", async () => {
    const h = makeHarness();
    h.threads.set("thread-2", thread({ id: "thread-2", agentKind: "codex:work" }));
    startTurn(h, "turn-a", "Other work", "thread-2");
    failTurn(h, "turn-a", "usage_limited", "thread-2");
    await settle(h, 1);
    expect(h.switches[0]).toMatchObject({ threadId: "thread-2", agentKind: "codex:home" });

    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 2);
    // codex:work ran out moments ago on thread-2, so thread-1 goes to codex:home.
    expect(h.switches[1]).toMatchObject({ threadId: "thread-1", agentKind: "codex:home" });
  });

  it("joins in-flight work on dispose and never publishes afterwards", async () => {
    const gate = Promise.withResolvers<void>();
    const h = makeHarness({
      overrides: {
        getAgentStatuses: async () => {
          await gate.promise;
          return agentStatusesResponseSchema.parse({ fromCache: true, windows: [], wsl: [] });
        },
      },
    });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    let disposed = false;
    const disposal = h.service.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    gate.resolve();
    await disposal;
    expect(h.switches).toEqual([]);
    expect(h.notices).toEqual([]);
  });
});

// ViscosityCode: account pool follow-ups (classification threshold, left-out
// accounts, held error notifications).
function usageAt(providerId: string, usedPercent: number): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    fetchedAt: NOW,
    windows: [{ id: "5h", label: "5h", usedPercent, resetsAt: NOW + 3_600_000 }],
  };
}

/** A failure the provider reports without a reason, ending the turn. */
function failTurnWithoutReason(h: Harness, turnId: string): void {
  h.emit({
    type: "thread-runtime-events",
    threadId: "thread-1",
    events: [
      { type: "error", threadId: "thread-1", message: "Network error" },
      { type: "turn.completed", threadId: "thread-1", turnId, state: "failed" },
    ],
  });
  h.emit(state("error"));
}

describe("AccountPoolFailoverService failure classification", () => {
  it("does not treat an unrelated failure as out of usage below 100% (switchAtPercent)", async () => {
    const h = makeHarness();
    h.pools.codex = { ...h.pools.codex!, switchAtPercent: 90 };
    h.emit({ type: "provider-usage", snapshot: usageAt("codex", 92) });
    startTurn(h, "turn-1", "Ship it");
    failTurnWithoutReason(h, "turn-1");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.pending).toEqual([]);
    expect(h.switches).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it("fails over a reasonless failure once the account is fully used", async () => {
    const h = makeHarness();
    h.pools.codex = { ...h.pools.codex!, switchAtPercent: 90 };
    h.emit({ type: "provider-usage", snapshot: usageAt("codex", 100) });
    startTurn(h, "turn-1", "Ship it");
    failTurnWithoutReason(h, "turn-1");
    await settle(h, 1);
    expect(h.switches[0]).toMatchObject({ agentKind: "codex:work" });
  });

  it("still applies switchAtPercent when choosing the next account", async () => {
    const h = makeHarness();
    h.pools.codex = { ...h.pools.codex!, switchAtPercent: 90 };
    h.emit({ type: "provider-usage", snapshot: usageAt("codex:work", 95) });
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    // codex:work is past the pool's 90% mark, so the work goes to codex:home.
    expect(h.switches[0]).toMatchObject({ agentKind: "codex:home" });
  });
});

describe("AccountPoolFailoverService left-out accounts", () => {
  it("never moves work to an account left out of the pool", async () => {
    const h = makeHarness();
    h.pools.codex = { ...h.pools.codex!, excludedMembers: ["codex:work"] };
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    expect(h.switches.map((entry) => entry.agentKind)).toEqual(["codex:home"]);
  });

  it("does not fail over a thread running on a left-out account", async () => {
    const h = makeHarness({ thread: { agentKind: "codex:work" } });
    h.pools.codex = { ...h.pools.codex!, excludedMembers: ["codex:work"] };
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.pending).toEqual([]);
    expect(h.switches).toEqual([]);
    expect(h.service.mayFailOver("thread-1")).toBe(false);
  });
});

describe("AccountPoolFailoverService held error notifications", () => {
  /** The provider names the reason first (the claim is synchronous), then the state settles. */
  function claimFailure(h: Harness, turnId: string): void {
    h.emit(
      runtime({
        type: "error",
        threadId: "thread-1",
        message: "You've hit your usage limit.",
        reason: "usage_limited",
      }),
    );
    h.emit(runtime({ type: "turn.completed", threadId: "thread-1", turnId, state: "failed" }));
  }

  it("publishes at once for a thread no pool can move", () => {
    const h = makeHarness({ enabled: false });
    expect(h.service.holdErrorNotification("thread-1", "codex")).toBeUndefined();
  });

  it("drops the error notification when the failover switches accounts", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    expect(held).toBeInstanceOf(Promise);
    await expect(held).resolves.toBe(false);
    expect(h.switches).toHaveLength(1);
  });

  it("publishes the error notification when every account is out", async () => {
    const h = makeHarness({
      usage: [exhausted("codex:work", NOW + 60_000), exhausted("codex:home", NOW + 90_000)],
    });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    await expect(held).resolves.toBe(true);
    expect(h.notices.map((notice) => notice.kind)).toEqual(["exhausted"]);
  });

  // ViscosityCode: the owner hears about a pool that ran dry once, not twice.
  it("drops the error notification when the 'all accounts out' notice stands in for it", async () => {
    const delivered: AccountPoolNotice[] = [];
    const h = makeHarness({
      usage: [exhausted("codex:work", NOW + 60_000), exhausted("codex:home", NOW + 90_000)],
      overrides: {
        publishNotice: (notice) => {
          delivered.push(notice);
          return notice.kind === "exhausted" || notice.kind === "switch-failed";
        },
      },
    });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    await expect(held).resolves.toBe(false);
    expect(delivered.map((notice) => notice.kind)).toEqual(["exhausted"]);
    // The thread still stays failed, with the pool's message.
    expect(h.settled.at(-1)?.[1]).toMatchObject({ kind: "failed" });
  });

  it("drops the error notification when a failed switch's notice stands in for it", async () => {
    const h = makeHarness({
      overrides: {
        switchThread: async () => {
          throw new Error("spawn failed");
        },
        publishNotice: (notice) => notice.kind === "switch-failed",
      },
    });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    await expect(held).resolves.toBe(false);
  });

  it("publishes the error notification when the stand-in notice could not be delivered", async () => {
    const h = makeHarness({
      usage: [exhausted("codex:work", NOW + 60_000), exhausted("codex:home", NOW + 90_000)],
      overrides: {
        publishNotice: () => {
          throw new Error("notification sink is gone");
        },
      },
    });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    await expect(held).resolves.toBe(true);
  });

  it("waits a short grace for a failover that is claimed after the error state", async () => {
    const h = makeHarness({ overrides: { errorNotificationGraceMs: 1_000 } });
    startTurn(h, "turn-1", "Ship it");
    // Some providers report the error state before their reasoned error event.
    h.emit(state("error", "thread-1", "codex"));
    const held = h.service.holdErrorNotification("thread-1", "codex");
    expect(held).toBeInstanceOf(Promise);
    claimFailure(h, "turn-1");
    await expect(held).resolves.toBe(false);
  });

  it("publishes after the grace when no failover claims the failure", async () => {
    const h = makeHarness({ overrides: { errorNotificationGraceMs: 10 } });
    startTurn(h, "turn-1", "Ship it");
    failTurnWithoutReason(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    await expect(held).resolves.toBe(true);
    expect(h.switches).toEqual([]);
  });

  it("never holds longer than its bound", async () => {
    const h = makeHarness({
      overrides: {
        errorNotificationHoldMs: 20,
        switchThread: () => new Promise<never>(() => {}),
      },
    });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    await expect(held).resolves.toBe(true);
  });

  it("never holds (or drops) an error from the account the switch is moving to", async () => {
    const switched = Promise.withResolvers<{ threadId: string }>();
    let switching = false;
    const h = makeHarness({
      overrides: {
        switchThread: () => {
          switching = true;
          return switched.promise;
        },
      },
    });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const heldOld = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    await vi.waitFor(() => expect(switching).toBe(true));
    // The new account's session fails before the switch call returns.
    expect(h.service.holdErrorNotification("thread-1", "codex:work")).toBeUndefined();
    switched.resolve({ threadId: "thread-1" });
    // The old account's error still goes away with the successful switch.
    await expect(heldOld).resolves.toBe(false);
  });

  it("drops a late error from the session a finished failover left behind", async () => {
    const h = makeHarness();
    startTurn(h, "turn-1", "Ship it");
    failTurn(h, "turn-1", "usage_limited");
    await settle(h, 1);
    expect(h.threads.get("thread-1")?.agentKind).toBe("codex:work");
    await expect(h.service.holdErrorNotification("thread-1", "codex")).resolves.toBe(false);
  });

  it("releases held notifications (publishing them) on dispose", async () => {
    const h = makeHarness({ overrides: { switchThread: () => new Promise<never>(() => {}) } });
    startTurn(h, "turn-1", "Ship it");
    claimFailure(h, "turn-1");
    const held = h.service.holdErrorNotification("thread-1", "codex");
    h.emit(state("error", "thread-1", "codex"));
    void h.service.dispose();
    await expect(held).resolves.toBe(true);
  });
});
