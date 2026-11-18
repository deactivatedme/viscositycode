/**
 * The desktop backend and the standalone (headless) server both compose
 * `BackendDurableServices`; these tests drive its shared supervisor-event
 * fan-out with each composition's client effects.
 */
import { describe, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import {
  agentStatusesResponseSchema,
  type Project,
  type RemoteThreadCommand,
  type RuntimeEvent,
  type Thread,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { defaultSharedSettings, type SharedSettings } from "@/shared/settings";
import {
  BackendDurableServices,
  type BackendDurableServicesOptions,
} from "@/backend/BackendDurableServices";
import { ThreadNotificationPublisher } from "@/host/remote/ThreadNotificationPublisher";
import type { UserNotification } from "@/shared/threadNotification";

const PROJECT: Project = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix", path: "/synthetic/repo" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const mocks = vi.hoisted(() => ({ thread: null as Thread | null }));

vi.mock("@/host/db", () => ({
  dbAdmitScheduleExecution: vi.fn<() => void>(),
  dbDeleteThread: vi.fn<() => void>(),
  dbGetProject: vi.fn<(id: string) => Project | null>((id) => (id === PROJECT.id ? PROJECT : null)),
  dbGetProjectNotes: vi.fn<() => undefined>(),
  dbGetProjects: vi.fn<() => Project[]>(() => [PROJECT]),
  dbGetState: vi.fn<() => string | null>(() => null),
  dbGetThread: vi.fn<(id: string) => Thread | null>((id) =>
    mocks.thread?.id === id ? mocks.thread : null,
  ),
  dbGetScheduleRun: vi.fn<() => null>(() => null),
  dbGetThreadRuntimeItemCursor: vi.fn<() => Promise<number>>(async () => -1),
  dbGetThreadRuntimeItemsAfter: vi.fn<() => Promise<never[]>>(async () => []),
  dbPatchScheduleRuntime: vi.fn<() => void>(),
  dbGetThreads: vi.fn<() => Thread[]>(() => (mocks.thread ? [mocks.thread] : [])),
  dbInsertScheduleRun: vi.fn<() => undefined>(),
  dbInterruptScheduleRuns: vi.fn<() => undefined>(),
  dbListThreadIds: vi.fn<() => string[]>(() => []),
  dbReconcileProjectWorktrees: vi.fn<() => string[]>(() => []),
  dbBeginWorktreeObservation: vi.fn<() => object>(() => ({})),
  dbUpdateScheduleRun: vi.fn<() => undefined>(),
  dbUpsertThread: vi.fn<(thread: Thread) => void>((thread) => {
    mocks.thread = thread;
  }),
  onThreadsDeleted: vi.fn<() => () => void>(() => () => {}),
}));

vi.mock("@/host/app-controls", () => ({
  AppControlsMcpIngress: class {
    getInfo = () => null;
    start = async () => ({ url: "http://127.0.0.1:0/mcp", token: "token" });
    observeSupervisorEvent = () => {};
    dispose = () => {};
  },
  buildSharedAppControlsIngressDeps: () => ({
    createThread: vi.fn<() => Promise<null>>(async () => null),
  }),
  createAppControlsSupervisorCaller: (call: unknown) => call,
}));

vi.mock("@/host/gitState", async (importOriginal) => ({
  ProjectWatchLeases: (await importOriginal<typeof import("@/host/gitState")>()).ProjectWatchLeases,
  createGitStateExecutor: () => ({}),
  GitStateService: class {
    start = () => {};
    dispose = () => {};
    observeSupervisorEvent = () => {};
    applyObservedPullRequest = () => {};
  },
}));

vi.mock("@/host/prWatch", () => ({
  buildPrWatchExecutionDeps: () => ({}),
  createDevicePrWatchService: () => ({
    start: () => {},
    dispose: () => {},
    observeSupervisorEvent: () => {},
  }),
}));

vi.mock("@/host/schedules", async (importOriginal) => ({
  ScheduleRunCoordinator: (await importOriginal<typeof import("@/host/schedules")>())
    .ScheduleRunCoordinator,
  createDeviceScheduleService: () => ({ start: () => {}, dispose: () => {} }),
}));

const STATUSES = agentStatusesResponseSchema.parse({
  fromCache: true,
  windows: [
    ["codex", "Codex"],
    ["codex:work", "Codex Work"],
  ].map(([kind, label]) => ({
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: { presentationMode: "gui", models: [{ id: "model-a", label: "Model A" }] },
  })),
  wsl: [],
});

function seedThread(): void {
  mocks.thread = {
    id: "thread-1",
    projectId: PROJECT.id,
    title: "Fix the build",
    agentKind: "codex",
    config: { model: "model-a" },
    status: "working",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function settingsWithPool(notificationsEnabled = true): SharedSettings {
  const settings = {
    ...defaultSharedSettings,
    notificationsEnabled,
    // The pooled profile is configured; a removed profile never takes work over.
    agentInstances: { work: { id: "work", driver: "codex", displayName: "Work" } },
    accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
  };
  return settings;
}

function createDurable(
  overrides: Partial<BackendDurableServicesOptions>,
  usage: readonly UsageSnapshot[] = [],
) {
  const call = vi.fn<(name: string, payload: unknown) => Promise<unknown>>(
    async (name, payload) => {
      if (name === "getAgentStatuses") return STATUSES;
      if (name === "getProviderUsage") return { snapshots: usage, fromCache: true };
      if (name === "startThread") return { threadId: (payload as { threadId: string }).threadId };
      return null;
    },
  );
  const options = {
    appVersion: "test",
    hostId: "device-1",
    supervisor: { call },
    getSharedSettings: () => settingsWithPool(),
    writeSharedSettings: () => {},
    editSettingsField: async () => ({ status: "committed" }),
    commitOwnerSettingsEdits: async () => {},
    sendThreadCommand: () => false,
    publishProjectsChanged: () => {},
    publishThreadsChanged: vi.fn<(ids: readonly string[]) => void>(),
    hasRendererWindow: false,
    openThreadInUi: () => false,
    notifyUser: vi.fn<() => Promise<{ delivered: boolean }>>(async () => ({ delivered: true })),
    checkForUpdate: async () => ({ supported: false, currentVersion: "test" }),
    onGitPatch: () => {},
    ...overrides,
  } as unknown as BackendDurableServicesOptions;
  return { durable: new BackendDurableServices(options), call, options };
}

function runtime(event: RuntimeEvent): SupervisorEvent {
  return { type: "thread-runtime-event", threadId: event.threadId, event };
}

function failOnUsage(durable: BackendDurableServices): void {
  const threadId = "thread-1";
  durable.observeSupervisorEvent(runtime({ type: "turn.started", threadId, turnId: "turn-1" }));
  durable.observeSupervisorEvent(
    runtime({
      type: "item.started",
      threadId,
      itemId: "user-1",
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: "Fix the build" }] },
    }),
  );
  durable.observeSupervisorEvent(
    runtime({ type: "error", threadId, message: "Usage limit reached.", reason: "usage_limited" }),
  );
  durable.observeSupervisorEvent({
    type: "thread-state",
    threadId,
    status: "error",
    attention: "none",
    canResumeWithConfig: false,
  });
}

function startCalls(call: ReturnType<typeof createDurable>["call"]) {
  return call.mock.calls.filter(([name]) => name === "startThread").map(([, payload]) => payload);
}

describe("account-pool failover wiring", () => {
  it("desktop: switches in place, mirrors the renderer and notifies the owner", async () => {
    seedThread();
    const mirrored: RemoteThreadCommand[] = [];
    const { durable, call, options } = createDurable({
      sendThreadCommand: () => true,
      emitRemoteThreadCommand: async (command: RemoteThreadCommand) => {
        mirrored.push(command);
        return true;
      },
      hasRendererWindow: true,
    });
    try {
      failOnUsage(durable);
      await vi.waitFor(() => expect(startCalls(call)).toHaveLength(1));
      expect(startCalls(call)[0]).toMatchObject({
        threadId: "thread-1",
        agentKind: "codex:work",
        prompt: "Fix the build",
        presentationMode: "gui",
        providerSwitch: { fromAgentKind: "codex", contextStrategy: "thread-transcript" },
      });
      expect(mocks.thread?.agentKind).toBe("codex:work");
      expect(mirrored).toEqual([
        expect.objectContaining({
          kind: "start",
          threadId: "thread-1",
          agentKind: "codex:work",
          launchRuntime: false,
          providerSwitch: expect.objectContaining({ fromAgentKind: "codex" }),
        }),
      ]);
      expect(options.publishThreadsChanged).toHaveBeenCalledWith(["thread-1"]);
      await vi.waitFor(() =>
        expect(options.notifyUser).toHaveBeenCalledWith({
          title: "Switched to Codex Work",
          body: "Codex is out of usage, so “Fix the build” continues on Codex Work.",
          threadId: "thread-1",
        }),
      );
    } finally {
      await durable.dispose();
    }
  });

  it("headless: switches with no renderer and honours a disabled notification switch", async () => {
    seedThread();
    const { durable, call, options } = createDurable({
      getSharedSettings: () => settingsWithPool(false),
    });
    try {
      failOnUsage(durable);
      await vi.waitFor(() => expect(startCalls(call)).toHaveLength(1));
      expect(startCalls(call)[0]).toMatchObject({ agentKind: "codex:work" });
      expect(mocks.thread?.agentKind).toBe("codex:work");
      expect(options.publishThreadsChanged).toHaveBeenCalledWith(["thread-1"]);
      expect(options.notifyUser).not.toHaveBeenCalled();
    } finally {
      await durable.dispose();
    }
  });

  it("never fails over to a removed profile still listed in a stored pool", async () => {
    seedThread();
    const { durable, call } = createDurable({
      getSharedSettings: () => ({ ...settingsWithPool(), agentInstances: {} }),
    });
    try {
      failOnUsage(durable);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(startCalls(call)).toEqual([]);
      expect(mocks.thread?.agentKind).toBe("codex");
    } finally {
      await durable.dispose();
    }
  });

  it("does nothing for settings without pools", async () => {
    seedThread();
    const { durable, call } = createDurable({ getSharedSettings: () => defaultSharedSettings });
    try {
      failOnUsage(durable);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(startCalls(call)).toEqual([]);
      expect(mocks.thread?.agentKind).toBe("codex");
    } finally {
      await durable.dispose();
    }
  });

  // ViscosityCode: the host notification publisher composed the way both hosts
  // compose it (durable services observe each event first).
  function composeNotifications(
    overrides: Partial<BackendDurableServicesOptions>,
    usage: readonly UsageSnapshot[] = [],
  ) {
    const published: UserNotification[] = [];
    let durable: BackendDurableServices | null = null;
    const publisher = new ThreadNotificationPublisher({
      getThread: () => mocks.thread,
      getProjectName: () => "Project",
      getSettings: () => ({
        notificationsEnabled: true,
        notificationStatuses: { done: true, needsAttention: true, error: true },
        notifyL2Cli: true,
      }),
      publish: (notification) => published.push(notification),
      holdErrorNotification: (threadId, agentKind) =>
        durable?.accountPoolFailover.holdErrorNotification(threadId, agentKind),
    });
    const created = createDurable(overrides, usage);
    durable = created.durable;
    const fanOut = (event: SupervisorEvent) => {
      if (!created.durable.observeSupervisorEvent(event)) publisher.handleSupervisorEvent(event);
    };
    return { ...created, publisher, published, fanOut };
  }

  function failOnUsageThroughFanOut(fanOut: (event: SupervisorEvent) => void): void {
    const threadId = "thread-1";
    fanOut({
      type: "thread-state",
      threadId,
      status: "working",
      attention: "none",
      canResumeWithConfig: false,
      agentKind: "codex",
    });
    fanOut(runtime({ type: "turn.started", threadId, turnId: "turn-1" }));
    fanOut(
      runtime({
        type: "item.started",
        threadId,
        itemId: "user-1",
        itemType: "user_message",
        payload: { content: [{ kind: "text", text: "Fix the build" }] },
      }),
    );
    fanOut(
      runtime({
        type: "error",
        threadId,
        message: "Usage limit reached.",
        reason: "usage_limited",
      }),
    );
    fanOut({
      type: "thread-state",
      threadId,
      status: "error",
      attention: "error",
      canResumeWithConfig: false,
      agentKind: "codex",
    });
  }

  it("drops the error notification of a thread that failed over successfully", async () => {
    seedThread();
    const { durable, call, published, fanOut } = composeNotifications({});
    try {
      failOnUsageThroughFanOut(fanOut);
      await vi.waitFor(() => expect(startCalls(call)).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(published.filter((entry) => entry.category === "error")).toEqual([]);
    } finally {
      await durable.dispose();
    }
  });

  it("headless: delivers 'all accounts out' to remote clients through the publisher", async () => {
    seedThread();
    const exhausted = (providerId: string): UsageSnapshot => ({
      providerId,
      status: "ok",
      fetchedAt: Date.now(),
      windows: [{ id: "5h", label: "5h", usedPercent: 100 }],
    });
    let composed: ReturnType<typeof composeNotifications> | null = null;
    composed = composeNotifications(
      {
        // The headless composition: no desktop app to show `notifyUser`.
        notifyUser: vi.fn<() => { delivered: boolean }>(() => ({ delivered: false })),
        publishThreadNotice: (notice) => composed?.publisher.publishThreadNotice(notice),
      },
      [exhausted("codex:work")],
    );
    const { durable, published, fanOut, options, call } = composed;
    try {
      failOnUsageThroughFanOut(fanOut);
      await vi.waitFor(() => expect(published).toHaveLength(1));
      expect(published[0]).toEqual({
        threadId: "thread-1",
        category: "error",
        projectName: "Codex accounts are out of usage",
        threadTitle: "All Codex accounts in your pool are out of usage.",
        status: "error",
      });
      // The held generic error was replaced, not published as well.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(published).toHaveLength(1);
      expect(options.notifyUser).not.toHaveBeenCalled();
      expect(startCalls(call)).toEqual([]);
    } finally {
      await durable.dispose();
    }
  });

  it("a host without a notification publisher: sends the owner only the 'all accounts out' notice, not the held error too", async () => {
    seedThread();
    const fullyUsed: UsageSnapshot = {
      providerId: "codex:work",
      status: "ok",
      fetchedAt: Date.now(),
      windows: [{ id: "5h", label: "5h", usedPercent: 100 }],
    };
    // The desktop composition: `notifyUser` reaches the owner, no `publishThreadNotice`.
    const { durable, published, fanOut, options, call } = composeNotifications({}, [fullyUsed]);
    try {
      failOnUsageThroughFanOut(fanOut);
      await vi.waitFor(() =>
        expect(options.notifyUser).toHaveBeenCalledWith({
          title: "Codex accounts are out of usage",
          body: "All Codex accounts in your pool are out of usage.",
          threadId: "thread-1",
        }),
      );
      // The held generic error is dropped once the failover settles.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(published.filter((entry) => entry.category === "error")).toEqual([]);
      expect(options.notifyUser).toHaveBeenCalledTimes(1);
      expect(startCalls(call)).toEqual([]);
    } finally {
      await durable.dispose();
    }
  });

  it("keeps the generic error notification when no pool is involved", async () => {
    seedThread();
    const { durable, published, fanOut, options } = composeNotifications({
      getSharedSettings: () => defaultSharedSettings,
    });
    try {
      failOnUsageThroughFanOut(fanOut);
      await vi.waitFor(() => expect(published).toHaveLength(1));
      expect(published[0]).toMatchObject({
        threadId: "thread-1",
        category: "error",
        threadTitle: "Fix the build",
      });
      expect(options.notifyUser).not.toHaveBeenCalled();
    } finally {
      await durable.dispose();
    }
  });
});
