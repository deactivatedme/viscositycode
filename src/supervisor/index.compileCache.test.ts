import { afterEach, expect, it, vi } from "vitest";

// ViscosityCode: the supervisor loads with the Node compile cache, but agent CLIs, the PTY
// broker and workers it spawns must not inherit NODE_COMPILE_CACHE.

const state = vi.hoisted(() => ({ envAtRuntimeStart: "unset" as string | undefined }));

vi.mock("@/shared/diagnostics/nodePerformanceDiagnostics", () => ({
  startNodePerformanceDiagnostics: () => undefined,
}));
vi.mock("./diagnostics/sentry", () => ({
  captureSupervisorException() {},
  async flushSupervisorSentry() {},
  initializeSupervisorSentry() {},
}));
vi.mock("./secretStorage", () => ({ configureSecretStorageKey() {} }));
vi.mock("./devOrphanWatchdog", () => ({ startDevOrphanWatchdog() {} }));
vi.mock("./supervisorShedPolicy", () => ({ createSupervisorOutputShedPolicy: () => ({}) }));
vi.mock("./ipcHandlers", () => ({ createSupervisorIpcHandlers: () => ({}) }));
vi.mock("./workspaceRuntimeRequest", () => ({
  createWorkspaceRuntimeRequestHandler: () => () => undefined,
}));
vi.mock("./supervisorIpcSender", () => ({
  SupervisorIpcSender: class {
    configuredLimits = { bulkBytes: 0, controlReserveBytes: 0 };
    sendMessage() {}
    emit() {}
    getCanonicalFlowGeneration() {
      return 0;
    }
  },
}));
vi.mock("./supervisorRuntime", () => ({
  SupervisorRuntime: class {
    threadSessionManager = {};
    constructor() {
      state.envAtRuntimeStart = process.env.NODE_COMPILE_CACHE;
    }
  },
}));

const ownedEvents = [
  "message",
  "disconnect",
  "SIGINT",
  "SIGTERM",
  "uncaughtException",
  "unhandledRejection",
] as const;
const previousListeners = new Map(
  ownedEvents.map((event) => [event, new Set(process.listeners(event))]),
);

afterEach(() => {
  for (const event of ownedEvents) {
    for (const listener of process.listeners(event)) {
      if (!previousListeners.get(event)!.has(listener)) process.off(event, listener);
    }
  }
  delete process.env.NODE_COMPILE_CACHE;
});

it("drops NODE_COMPILE_CACHE before the runtime can spawn anything", async () => {
  process.env.NODE_COMPILE_CACHE = "/data/cache/node-compile-cache";
  await import("./index");
  expect(state.envAtRuntimeStart).toBeUndefined();
  expect(process.env.NODE_COMPILE_CACHE).toBeUndefined();
});
