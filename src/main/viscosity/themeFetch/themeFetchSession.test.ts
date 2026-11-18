import { describe, expect, it, vi } from "vitest";
import { createThemeHopGuard, ThemeFetchHopRefused } from "./themeFetch";
import {
  createThemeSessionFetch,
  installThemeHopGuard,
  type ThemeFetchSession,
} from "./themeFetchSession";

type BeforeRequest = Parameters<ThemeFetchSession["webRequest"]["onBeforeRequest"]>[0];
type Finished = Parameters<ThemeFetchSession["webRequest"]["onCompleted"]>[0];

/** The slice of an Electron session the feature uses; `fetch` stands in for `net.fetch`. */
function fakeSession(fetch: ThemeFetchSession["fetch"]) {
  const listeners: { before?: BeforeRequest; completed?: Finished; failed?: Finished } = {};
  const session: ThemeFetchSession = {
    fetch,
    webRequest: {
      onBeforeRequest: (listener) => {
        listeners.before = listener;
      },
      onCompleted: (listener) => {
        listeners.completed = listener;
      },
      onErrorOccurred: (listener) => {
        listeners.failed = listener;
      },
    },
  };
  /** Runs one request hop through the guard; true when it was cancelled. */
  function hop(id: number, url: string): boolean {
    let cancelled: boolean | undefined;
    listeners.before?.({ id, url }, (response) => {
      cancelled = response.cancel === true;
    });
    if (cancelled === undefined) throw new Error("the guard never answered");
    return cancelled;
  }
  return { session, listeners, hop };
}

describe("installThemeHopGuard", () => {
  it("cancels hops the guard refuses on the dedicated session, and forgets finished requests", () => {
    const { session, listeners, hop } = fakeSession(vi.fn<ThemeFetchSession["fetch"]>());
    installThemeHopGuard(session, createThemeHopGuard(1));
    expect(hop(1, "https://themes.example.com/a.json")).toBe(false);
    expect(hop(1, "http://themes.example.com/a.json")).toBe(true);
    expect(hop(2, "https://themes.example.com/a.json")).toBe(false);
    expect(hop(2, "https://192.168.1.1/a.json")).toBe(true);
    expect(hop(3, "https://themes.example.com/a.json")).toBe(false);
    expect(hop(3, "https://cdn.example.com/a.json")).toBe(false);
    // One redirect allowed: the second is refused.
    expect(hop(3, "https://cdn2.example.com/a.json")).toBe(true);
    listeners.completed?.({ id: 3, url: "" });
    expect(hop(3, "https://themes.example.com/a.json")).toBe(false);
    listeners.failed?.({ id: 3, url: "" });
    expect(hop(3, "https://themes.example.com/a.json")).toBe(false);
  });
});

describe("createThemeSessionFetch", () => {
  it("downloads with the session's net.fetch", async () => {
    const netFetch = vi.fn<ThemeFetchSession["fetch"]>(async () => new Response("{}"));
    const { session } = fakeSession(netFetch);
    const getSession = vi.fn<() => ThemeFetchSession>(() => session);
    const fetch = createThemeSessionFetch(getSession);
    expect(getSession).not.toHaveBeenCalled();
    const init: RequestInit = { method: "GET", redirect: "follow" };
    await expect(fetch("https://themes.example.com/a.json", init)).resolves.toBeInstanceOf(
      Response,
    );
    expect(netFetch).toHaveBeenCalledExactlyOnceWith("https://themes.example.com/a.json", init);
  });

  it("reports a hop the guard cancelled as ThemeFetchHopRefused and passes other failures on", async () => {
    const blocked = createThemeSessionFetch(
      () => fakeSession(() => Promise.reject(new Error("net::ERR_BLOCKED_BY_CLIENT"))).session,
    );
    await expect(blocked("https://themes.example.com/a.json", {})).rejects.toBeInstanceOf(
      ThemeFetchHopRefused,
    );
    const offline = new Error("net::ERR_INTERNET_DISCONNECTED");
    const failing = createThemeSessionFetch(
      () => fakeSession(() => Promise.reject(offline)).session,
    );
    await expect(failing("https://themes.example.com/a.json", {})).rejects.toBe(offline);
  });
});
