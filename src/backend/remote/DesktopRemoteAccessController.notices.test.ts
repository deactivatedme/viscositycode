// ViscosityCode: account-pool notices on a desktop host. The controller's thread
// notification publisher delivers them as the headless server does: once to
// connected remote clients and once to the desktop's native notification path,
// replacing the thread's held error notification.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { defaultSharedSettings, type SharedSettings } from "@/shared/settings";
import type { UserNotification } from "@/shared/threadNotification";
import type {
  RemoteAccessServerInfo,
  RemoteAccessServerOptions,
} from "@/host/remote/RemoteAccessServer";

const h = vi.hoisted(() => ({
  settings: {} as SharedSettings,
  published: [] as unknown[],
}));

function thread(): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Ship it",
    agentKind: "codex",
    config: { model: "gpt-5" },
    status: "working",
    attention: "working",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

vi.mock("@/host/db", () => ({
  dbGetProjects: () => [],
  dbGetThreads: () => [],
  dbGetProject: () => ({ name: "Repo" }),
  dbGetThread: (threadId: string) => (threadId === "thread-1" ? thread() : null),
  dbUpdateProject: vi.fn<(project: unknown) => void>(),
}));
vi.mock("@/host/sharedSettingsFile", () => ({
  readSharedSettingsFile: () => h.settings,
}));
vi.mock("@/host/remote/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/host/remote/config")>()),
  remoteAccessAdvertisedHost: () => "127.0.0.1",
  remoteAccessHost: () => "127.0.0.1",
  remoteAccessPairingAppUrl: () => undefined,
  remoteForwardBaseUrl: () => undefined,
  resolveRemoteAccessPort: async () => 43123,
}));
vi.mock("@/host/remote/identity", () => ({
  readOrCreateRemoteAccessIdentity: () => ({ desktopId: "fixture-host", label: "Fixture" }),
}));
vi.mock("@/host/remote/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/host/remote/auth")>()),
  createPersistentRemoteAuthStore: () => ({}),
}));
vi.mock("@/host/remote/portForward/portForwarding", () => ({
  createPortForwarding: () => ({ gateway: {}, proxy: {}, dispose() {} }),
}));
vi.mock("@/host/remote/RemoteBrowserGateway", () => ({ RemoteBrowserGateway: class {} }));
vi.mock("@/host/remote/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/host/remote/push")>()),
  createPushGateway: () => async () => ({ ok: true, status: 200, unregistered: false }),
}));
vi.mock("@/host/remote/tailscale", () => ({
  buildTailscaleHttpsUrl: () => "https://fixture.test",
  disableTailscaleServe: async () => {},
  enableTailscaleServe: async () => ({ ok: true }),
  launchTailscaleApp: async () => ({ ok: true }),
  probeTailscaleStatus: async () => ({ state: "not-running" }),
}));
vi.mock("@/host/remote/RemoteAccessServer", () => ({
  RemoteAccessServer: class {
    private info: RemoteAccessServerInfo | null = null;
    constructor(readonly options: RemoteAccessServerOptions) {}
    async start() {
      this.info = {
        httpBaseUrl: "http://127.0.0.1:43123/",
        localHttpBaseUrl: "http://127.0.0.1:43123",
        wsBaseUrl: "ws://127.0.0.1:43123/ws",
        pairingUrl: "http://127.0.0.1:43123/pair#token=synthetic",
        pairingExpiresAt: "2026-09-13T00:10:00.000Z",
      };
      return this.info;
    }
    async dispose() {
      this.info = null;
    }
    getInfo() {
      return this.info;
    }
    listAccessSessions() {
      return [];
    }
    publishSupervisorEvent(event: unknown) {
      h.published.push(event);
    }
  },
}));

import {
  createDesktopRemoteAccessController,
  type DesktopRemoteAccessController,
} from "./DesktopRemoteAccessController";

const NOTICE = {
  threadId: "thread-1",
  title: "Codex accounts are out of usage",
  body: "All Codex accounts in your pool are out of usage.",
};

const NOTICE_NOTIFICATION: UserNotification = {
  threadId: "thread-1",
  category: "error",
  projectName: NOTICE.title,
  threadTitle: NOTICE.body,
  status: "error",
};

const fixtures: Array<{ root: string; controller: DesktopRemoteAccessController }> = [];

beforeEach(() => {
  h.settings = { ...defaultSharedSettings, remotePushEnabled: false };
  h.published.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  for (const { root, controller } of fixtures.splice(0)) {
    await controller.dispose().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function fixture(hold?: (threadId: string, agentKind?: string) => Promise<boolean> | undefined): {
  controller: DesktopRemoteAccessController;
  notifyUserNotification: ReturnType<typeof vi.fn<(notification: UserNotification) => void>>;
} {
  const root = mkdtempSync(join(tmpdir(), "poracode-desktop-pool-notice-"));
  const notifyUserNotification = vi.fn<(notification: UserNotification) => void>();
  const controller = createDesktopRemoteAccessController({
    appVersion: "fixture",
    channel: "stable",
    paths: { baseDir: root, settingsPath: join(root, "settings.json") },
    callSupervisor: vi.fn<RemoteAccessServerOptions["callSupervisor"]>(),
    truncateThreadRuntime: vi.fn<NonNullable<RemoteAccessServerOptions["truncateThreadRuntime"]>>(),
    dispatchThreadCommand: () => false,
    settingsWrites: {
      commitCompatPatch: async (patch) => {
        const merged = { ...h.settings } as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) merged[key] = value;
        }
        h.settings = merged as SharedSettings;
        return h.settings;
      },
      editSettingsField: async () => {
        throw new Error("Fixture settings edits are not expected.");
      },
    },
    notifyRemoteAccessPairingChanged() {},
    notifyProjectStateChanged() {},
    notifyUserNotification,
    ...(hold ? { holdErrorNotification: hold } : {}),
    notifyEventInterestsChanged() {},
    reportError() {},
    scheduleService: {} as never,
    prWatchService: {} as never,
    gitStateService: {} as never,
    updates: {} as never,
  });
  fixtures.push({ root, controller });
  return { controller, notifyUserNotification };
}

function remoteNotifications(): unknown[] {
  return h.published.filter(
    (event) => (event as { type?: unknown }).type === "remote-user-notification",
  );
}

function state(status: "working" | "error"): SupervisorEvent {
  return {
    type: "thread-state",
    threadId: "thread-1",
    status,
    attention: status === "error" ? "error" : "working",
    canResumeWithConfig: false,
    agentKind: "codex",
  };
}

/** Lets every settled hold's callbacks run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("DesktopRemoteAccessController account-pool notices", () => {
  it("delivers a notice once to remote clients and once to the desktop", async () => {
    const { controller, notifyUserNotification } = fixture();
    await controller.setEnabled(true);

    expect(controller.publishThreadNotice(NOTICE)).toBe(true);

    expect(remoteNotifications()).toEqual([
      { type: "remote-user-notification", ...NOTICE_NOTIFICATION },
    ]);
    expect(notifyUserNotification).toHaveBeenCalledExactlyOnceWith(NOTICE_NOTIFICATION);
  });

  it("still reaches the desktop owner while remote access is off", () => {
    const { controller, notifyUserNotification } = fixture();

    expect(controller.publishThreadNotice(NOTICE)).toBe(true);

    expect(h.published).toEqual([]);
    expect(notifyUserNotification).toHaveBeenCalledExactlyOnceWith(NOTICE_NOTIFICATION);
  });

  it("replaces the thread's held error notification instead of adding to it", async () => {
    const held = Promise.withResolvers<boolean>();
    const hold = vi.fn<(threadId: string, agentKind?: string) => Promise<boolean> | undefined>(
      () => held.promise,
    );
    const { controller, notifyUserNotification } = fixture(hold);
    await controller.setEnabled(true);
    controller.handleSupervisorEvent(state("working"));
    controller.handleSupervisorEvent(state("error"));
    expect(hold).toHaveBeenCalledExactlyOnceWith("thread-1", "codex");
    expect(notifyUserNotification).not.toHaveBeenCalled();

    controller.publishThreadNotice(NOTICE);
    // Even a hold that later asks to publish cannot bring the generic error back.
    held.resolve(true);
    await flush();

    expect(remoteNotifications()).toEqual([
      { type: "remote-user-notification", ...NOTICE_NOTIFICATION },
    ]);
    expect(notifyUserNotification).toHaveBeenCalledExactlyOnceWith(NOTICE_NOTIFICATION);
  });

  it("honours a disabled error notification setting", async () => {
    h.settings = {
      ...h.settings,
      notificationStatuses: { ...h.settings.notificationStatuses, error: false },
    };
    const { controller, notifyUserNotification } = fixture();
    await controller.setEnabled(true);

    expect(controller.publishThreadNotice(NOTICE)).toBe(false);

    expect(remoteNotifications()).toEqual([]);
    expect(notifyUserNotification).not.toHaveBeenCalled();
  });
});
