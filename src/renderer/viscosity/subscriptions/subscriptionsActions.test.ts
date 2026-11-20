import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { canOpenLocalAgentSettings, startAccountSignIn } from "./subscriptionsActions";

const session = vi.hoisted(() => ({
  browser: false,
  bridgeHost: undefined as { desktopId: string; label: string } | undefined,
  login: vi.fn<(input: { project?: Project }) => boolean>(() => true),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({}),
  isRemoteSession: () => session.browser,
}));
vi.mock("@/renderer/actions/agentLoginActions", () => ({
  runAgentLoginCommand: session.login,
}));
vi.mock("@/renderer/state/remoteServers/browserBridge", () => ({
  selectBrowserBridgeClientServer: () => session.bridgeHost,
}));

afterEach(() => {
  session.browser = false;
  session.bridgeHost = undefined;
  session.login.mockClear();
  useAppStore.setState({ projects: [] });
  Reflect.deleteProperty(window, "viscosityShell");
});

describe("canOpenLocalAgentSettings", () => {
  it("is true on the Electron desktop client", () => {
    expect(canOpenLocalAgentSettings()).toBe(true);
  });

  it("is true in the Tauri desktop window", () => {
    session.browser = true;
    Object.assign(window, { viscosityShell: Object.freeze({ kind: "tauri", version: 1 }) });
    expect(canOpenLocalAgentSettings()).toBe(true);
  });

  it("is false in a plain browser client", () => {
    session.browser = true;
    expect(canOpenLocalAgentSettings()).toBe(false);
  });
});

describe("startAccountSignIn", () => {
  const status = {
    kind: "agent",
    label: "Agent",
    loginCommand: "agent login",
  } as AgentStatus;

  it("runs the Tauri window's login on its bridge host, not the first paired host's project", () => {
    session.browser = true;
    session.bridgeHost = { desktopId: "home", label: "Home" };
    Object.assign(window, { viscosityShell: Object.freeze({ kind: "tauri", version: 1 }) });
    const project = (host: string, id: string): Project => ({
      id: `remote:${host}:project:${id}`,
      name: id,
      createdAt: "2026-01-01T00:00:00.000Z",
      remoteServerId: host,
      remoteId: id,
      location: { kind: "posix", path: `/work/${id}`, remoteServerId: host },
    });
    useAppStore.setState({ projects: [project("other", "a"), project("home", "b")] });

    expect(startAccountSignIn(status, "usage")).toBe(true);
    expect(session.login.mock.calls[0]?.[0].project?.id).toBe("remote:home:project:b");
  });

  it("leaves the desktop client's own project choice alone", () => {
    expect(startAccountSignIn(status, "usage")).toBe(true);
    expect(session.login.mock.calls[0]?.[0].project).toBeUndefined();
  });
});
