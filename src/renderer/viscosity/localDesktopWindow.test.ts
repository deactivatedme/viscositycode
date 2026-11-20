import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IPC_PROCEDURE_MAP_VERSION, type PoracodeBridge } from "@/shared/ipc";
import { hostServiceCapabilities } from "@/shared/hostControlProtocol";
import { PORACODE_CLIENT_RUNTIME_VERSION, type ElectronHostBridge } from "@/shared/clientRuntime";
import {
  installBrowserClientRuntime,
  installElectronClientRuntime,
  resetClientRuntimeForTest,
} from "@/renderer/clientRuntime";
import type { RemoteServerRecord } from "@/renderer/state/remoteServers/types";
import {
  __resetRemoteServersStoreForTest,
  useRemoteServersStore,
} from "@/renderer/state/remoteServersStore";
import { isLocalDesktopHost, isLocalDesktopWindow } from "./localDesktopWindow";

const initialStore = useRemoteServersStore.getState();

function setShell(value: unknown): void {
  Object.assign(window, { viscosityShell: value });
}

function installBrowser(): void {
  const bridge = { arch: "web" } as unknown as PoracodeBridge;
  window.poracode = bridge;
  installBrowserClientRuntime(bridge);
}

function server(key: string, endpoint: string): RemoteServerRecord {
  return { desktopId: key, label: key, endpoint, accessToken: "token", scopes: [] };
}

beforeEach(() => {
  resetClientRuntimeForTest();
  Reflect.deleteProperty(window, "poracode");
  Reflect.deleteProperty(window, "poracodeHost");
  Reflect.deleteProperty(window, "viscosityShell");
});

afterEach(() => {
  Reflect.deleteProperty(window, "viscosityShell");
  __resetRemoteServersStoreForTest();
  useRemoteServersStore.setState({ ...initialStore, servers: [], runtime: {} });
});

describe("isLocalDesktopWindow", () => {
  it("is false in a plain browser without the shell global", () => {
    installBrowser();
    expect(isLocalDesktopWindow()).toBe(false);
  });

  it("is true for the v1 Tauri shell global in the browser client", () => {
    installBrowser();
    setShell(Object.freeze({ kind: "tauri", version: 1 }));
    expect(isLocalDesktopWindow()).toBe(true);
  });

  it.each([
    { kind: "tauri", version: 2 },
    { kind: "electron", version: 1 },
    { kind: "tauri", version: "1" },
    null,
  ])("treats an unknown shell global %o as a plain browser", (value) => {
    installBrowser();
    setShell(value);
    expect(isLocalDesktopWindow()).toBe(false);
  });

  it("is false before any client runtime is installed", () => {
    setShell({ kind: "tauri", version: 1 });
    expect(isLocalDesktopWindow()).toBe(false);
  });

  it("is false in the managed Electron runtime", () => {
    const host = {
      clientRuntimeVersion: PORACODE_CLIENT_RUNTIME_VERSION,
      arch: "x64",
      platform: "darwin",
      hostCapabilities: hostServiceCapabilities({}),
      onSupervisorEvent: () => () => {},
      onBackendSupervisorReset: () => () => {},
      ipcProcedureMapVersion: IPC_PROCEDURE_MAP_VERSION,
      invokeProcedure: async () => undefined,
    } as unknown as ElectronHostBridge;
    window.poracodeHost = host;
    installElectronClientRuntime(host);
    setShell({ kind: "tauri", version: 1 });
    expect(isLocalDesktopWindow()).toBe(false);
  });
});

describe("isLocalDesktopHost", () => {
  beforeEach(() => {
    useRemoteServersStore.setState({
      servers: [
        server("local", `${window.location.origin}/`),
        server("other", "http://192.0.2.10:43210/"),
        server("broken", "not a url"),
      ],
    });
  });

  it("is true only for the record served from this window's origin", () => {
    installBrowser();
    setShell({ kind: "tauri", version: 1 });
    expect(isLocalDesktopHost("local")).toBe(true);
    expect(isLocalDesktopHost("other")).toBe(false);
    expect(isLocalDesktopHost("broken")).toBe(false);
    expect(isLocalDesktopHost("unknown")).toBe(false);
    expect(isLocalDesktopHost(undefined)).toBe(false);
  });

  it("is false for the same-origin record outside the Tauri shell", () => {
    installBrowser();
    expect(isLocalDesktopHost("local")).toBe(false);
  });
});
