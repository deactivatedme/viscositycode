/**
 * ViscosityCode: the Electron wiring of `viscosity:theme:fetch`. Downloads go
 * through `net.fetch` on a dedicated in-memory session (Chromium's network
 * stack: system proxy, OS certificate store) whose every hop passes the guard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_FETCH_IPC } from "./themeFetchContract";
import { THEME_FETCH_PARTITION } from "./themeFetchSession";

type Handler = (event: unknown, url: unknown) => Promise<unknown> | unknown;
type BeforeRequest = (
  details: { id: number; url: string },
  callback: (response: { cancel?: boolean }) => void,
) => void;

const electron = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const state: { beforeRequest?: BeforeRequest } = {};
  const netFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const session = {
    fetch: netFetch,
    webRequest: {
      onBeforeRequest: vi.fn<(listener: BeforeRequest) => void>((listener) => {
        state.beforeRequest = listener;
      }),
      onCompleted: vi.fn<(listener: unknown) => void>(),
      onErrorOccurred: vi.fn<(listener: unknown) => void>(),
    },
  };
  return {
    handlers,
    state,
    netFetch,
    session,
    fromPartition: vi.fn<(partition: string, options?: unknown) => typeof session>(() => session),
    handle: vi.fn<(channel: string, listener: Handler) => void>((channel, listener) => {
      handlers.set(channel, listener);
    }),
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: electron.handle },
  session: { fromPartition: electron.fromPartition },
}));

import { registerViscosityThemeFetchIpc } from "./registerThemeFetchIpc";

const THEME_JSON = JSON.stringify({
  version: 1,
  label: "Shared night",
  light: {
    bg: "#ffffff",
    surface: "#f4f4f4",
    fg: "#111111",
    accent: "#3366cc",
    accentFg: "#ffffff",
    border: "#dddddd",
  },
  dark: {
    bg: "#101010",
    surface: "#161616",
    fg: "#eeeeee",
    accent: "#66aaff",
    accentFg: "#001122",
    border: "#333333",
  },
});
const URL_A = "https://themes.example.com/night.json";
const mainFrame = { routingId: 1, processId: 7 };
const fromMainFrame = { senderFrame: mainFrame, sender: { mainFrame } };

function handler(): Handler {
  const registered = electron.handlers.get(THEME_FETCH_IPC.fetch);
  if (!registered) throw new Error("channel not registered");
  return registered;
}

beforeEach(() => {
  electron.netFetch.mockReset();
});

describe("registerViscosityThemeFetchIpc", () => {
  it("registers the channel once and creates the download session on first use", () => {
    registerViscosityThemeFetchIpc();
    registerViscosityThemeFetchIpc();
    expect(electron.handle).toHaveBeenCalledTimes(1);
    expect(electron.handle).toHaveBeenCalledWith(THEME_FETCH_IPC.fetch, expect.any(Function));
    // Not before the app is ready: nothing touches the session until a download.
    expect(electron.fromPartition).not.toHaveBeenCalled();
  });

  it("downloads through the guarded session's net.fetch", async () => {
    registerViscosityThemeFetchIpc();
    electron.netFetch.mockResolvedValue(new Response(THEME_JSON));
    await expect(handler()(fromMainFrame, URL_A)).resolves.toEqual({
      ok: true,
      value: { text: THEME_JSON, url: URL_A },
    });
    expect(electron.fromPartition).toHaveBeenCalledExactlyOnceWith(THEME_FETCH_PARTITION, {
      cache: false,
    });
    expect(THEME_FETCH_PARTITION.startsWith("persist:")).toBe(false);
    expect(electron.netFetch).toHaveBeenCalledExactlyOnceWith(
      URL_A,
      expect.objectContaining({ method: "GET", redirect: "follow", credentials: "omit" }),
    );

    // Every hop of that session passes the guard.
    const cancelled = (url: string) => {
      let cancel: boolean | undefined;
      electron.state.beforeRequest?.({ id: 99, url }, (response) => {
        cancel = response.cancel;
      });
      return cancel;
    };
    expect(cancelled(URL_A)).toBe(false);
    expect(cancelled("https://127.0.0.1/night.json")).toBe(true);

    await handler()(fromMainFrame, URL_A);
    expect(electron.fromPartition).toHaveBeenCalledTimes(1);
  });

  it("answers an error page with the generic code only", async () => {
    registerViscosityThemeFetchIpc();
    electron.netFetch.mockResolvedValue(new Response("<h1>Internal error</h1>", { status: 500 }));
    const reply = await handler()(fromMainFrame, URL_A);
    expect(reply).toEqual({ ok: false, error: { code: "network" } });
    expect(JSON.stringify(reply)).not.toMatch(/500|Internal/);
  });

  it("reports a refused redirect hop as a redirect failure", async () => {
    registerViscosityThemeFetchIpc();
    electron.netFetch.mockRejectedValue(new Error("net::ERR_BLOCKED_BY_CLIENT"));
    await expect(handler()(fromMainFrame, URL_A)).resolves.toEqual({
      ok: false,
      error: { code: "redirect" },
    });
  });

  it("never downloads for a subframe or a local host", async () => {
    registerViscosityThemeFetchIpc();
    const subframe = { senderFrame: { routingId: 2, processId: 7 }, sender: { mainFrame } };
    expect(await handler()(subframe, URL_A)).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    await expect(handler()(fromMainFrame, "https://localhost/night.json")).resolves.toEqual({
      ok: false,
      error: { code: "network" },
    });
    expect(electron.netFetch).not.toHaveBeenCalled();
  });
});
