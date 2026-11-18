import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_THEME_JSON_LENGTH } from "@/shared/customThemes";
import {
  THEME_URL_MAX_BYTES,
  checkThemeUrl,
  fetchThemeFromUrl,
  readThemeFetchBridge,
  type ThemeFetchBridge,
} from "./themeUrlImport";

const palette = {
  bg: "#101010",
  surface: "#161616",
  fg: "#eeeeee",
  accent: "#66aaff",
  accentFg: "#001122",
  border: "#333333",
};
const DOC = { version: 1, label: "Shared night", light: palette, dark: palette };
const URL_A = "https://themes.example.com/night.json";

function bridgeReplying(reply: unknown): ThemeFetchBridge & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchTheme: async (url) => {
      calls.push(url);
      return reply;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "viscosityHost");
});

describe("checkThemeUrl", () => {
  it("accepts https links, trimmed and without the fragment", () => {
    expect(checkThemeUrl(`  ${URL_A}#x  `)).toEqual({ ok: true, url: URL_A });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["http://themes.example.com/a.json", "not-https"],
    ["file:///Users/me/theme.json", "not-https"],
    ["javascript:alert(1)", "not-https"],
    ["themes.example.com/a.json", "invalid-url"],
    ["https://", "invalid-url"],
    ["https://me:pw@themes.example.com/a.json", "invalid-url"],
    [`https://themes.example.com/${"a".repeat(2_100)}`, "invalid-url"],
  ])("refuses %j as %s", (raw, code) => {
    expect(checkThemeUrl(raw)).toEqual({ ok: false, code });
  });

  it("uses the theme JSON size limit", () => {
    expect(THEME_URL_MAX_BYTES).toBe(MAX_THEME_JSON_LENGTH);
  });
});

describe("fetchThemeFromUrl", () => {
  it("parses a downloaded v1 document", async () => {
    const bridge = bridgeReplying({ ok: true, value: { text: JSON.stringify(DOC), url: URL_A } });
    await expect(fetchThemeFromUrl(` ${URL_A} `, { bridge })).resolves.toEqual({
      ok: true,
      doc: DOC,
      url: URL_A,
    });
    expect(bridge.calls).toEqual([URL_A]);
  });

  it("validates the link before asking the bridge", async () => {
    const bridge = bridgeReplying(null);
    await expect(
      fetchThemeFromUrl("http://themes.example.com/a.json", { bridge }),
    ).resolves.toEqual({ ok: false, code: "not-https" });
    expect(bridge.calls).toEqual([]);
  });

  it("re-validates the schema even when main says ok", async () => {
    const future = bridgeReplying({
      ok: true,
      value: { text: JSON.stringify({ ...DOC, version: 2 }), url: URL_A },
    });
    await expect(fetchThemeFromUrl(URL_A, { bridge: future })).resolves.toEqual({
      ok: false,
      code: "not-theme",
    });
    const huge = bridgeReplying({
      ok: true,
      value: { text: " ".repeat(THEME_URL_MAX_BYTES + 1), url: URL_A },
    });
    await expect(fetchThemeFromUrl(URL_A, { bridge: huge })).resolves.toEqual({
      ok: false,
      code: "too-large",
    });
  });

  it("passes main's error codes through and folds unknown replies into network", async () => {
    await expect(
      fetchThemeFromUrl(URL_A, {
        bridge: bridgeReplying({ ok: false, error: { code: "http-error", status: 404 } }),
      }),
    ).resolves.toEqual({ ok: false, code: "http-error", status: 404 });
    await expect(
      fetchThemeFromUrl(URL_A, {
        bridge: bridgeReplying({ ok: false, error: { code: "timeout" } }),
      }),
    ).resolves.toEqual({ ok: false, code: "timeout" });
    await expect(
      fetchThemeFromUrl(URL_A, {
        bridge: bridgeReplying({ ok: false, error: { code: "teapot" } }),
      }),
    ).resolves.toEqual({ ok: false, code: "network" });
    await expect(fetchThemeFromUrl(URL_A, { bridge: bridgeReplying("garbage") })).resolves.toEqual({
      ok: false,
      code: "network",
    });
    const rejecting: ThemeFetchBridge = { fetchTheme: () => Promise.reject(new Error("gone")) };
    await expect(fetchThemeFromUrl(URL_A, { bridge: rejecting })).resolves.toEqual({
      ok: false,
      code: "network",
    });
  });

  it("reports unavailable without a desktop bridge", async () => {
    await expect(fetchThemeFromUrl(URL_A, { bridge: null })).resolves.toEqual({
      ok: false,
      code: "unavailable",
    });
    await expect(fetchThemeFromUrl(URL_A)).resolves.toEqual({ ok: false, code: "unavailable" });
  });

  it("gives up when the bridge never replies", async () => {
    vi.useFakeTimers();
    const silent: ThemeFetchBridge = { fetchTheme: () => new Promise(() => {}) };
    const pending = fetchThemeFromUrl(URL_A, { bridge: silent, replyTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ ok: false, code: "timeout" });
  });
});

describe("readThemeFetchBridge", () => {
  it("finds the preload namespace and ignores malformed ones", async () => {
    expect(readThemeFetchBridge()).toBeNull();
    Reflect.set(window, "viscosityHost", { xai: {} });
    expect(readThemeFetchBridge()).toBeNull();
    Reflect.set(window, "viscosityHost", { themes: { fetchTheme: "nope" } });
    expect(readThemeFetchBridge()).toBeNull();
    const themes = {
      prefix: "bound",
      fetchTheme(this: { prefix: string }, url: string) {
        return Promise.resolve(`${this.prefix}:${url}`);
      },
    };
    Reflect.set(window, "viscosityHost", { themes });
    await expect(readThemeFetchBridge()!.fetchTheme(URL_A)).resolves.toBe(`bound:${URL_A}`);
  });
});
