import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_THEME_JSON_LENGTH } from "@/shared/customThemes";
import {
  THEME_FETCH_MAX_BYTES,
  THEME_FETCH_MAX_REDIRECTS,
  THEME_FETCH_TIMEOUT_MS,
  isThemeFetchResult,
  readThemeFetchResult,
} from "./themeFetchContract";
import {
  checkThemeFetchUrl,
  createThemeHopGuard,
  fetchThemeDocumentText,
  ThemeFetchHopRefused,
  type ThemeFetchFn,
} from "./themeFetch";
import { createThemeFetchHandler, isThemeFetchMainFrameSender } from "./themeFetchIpc";

const palette = {
  bg: "#101010",
  surface: "#161616",
  fg: "#eeeeee",
  accent: "#66aaff",
  accentFg: "#001122",
  border: "#333333",
};
const THEME_JSON = JSON.stringify({
  version: 1,
  label: "Shared night",
  light: { ...palette, bg: "#ffffff", fg: "#111111" },
  dark: palette,
});

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function fakeFetch(
  routes: Record<string, () => Response | Promise<Response>>,
): ThemeFetchFn & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn<ThemeFetchFn>(async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route();
  });
  return Object.assign(fn, { calls });
}

const URL_A = "https://themes.example.com/night.json";

afterEach(() => {
  vi.useRealTimers();
});

describe("theme URL rules", () => {
  it("accepts https links and drops the fragment", () => {
    const checked = checkThemeFetchUrl("  https://themes.example.com/a.json#preview ");
    expect(checked.ok && checked.url.href).toBe("https://themes.example.com/a.json");
  });

  it.each([
    ["http://themes.example.com/a.json", "not-https"],
    ["file:///etc/passwd", "not-https"],
    ["javascript:alert(1)", "not-https"],
    ["data:application/json,{}", "not-https"],
    ["ftp://themes.example.com/a.json", "not-https"],
    ["themes.example.com/a.json", "invalid-url"],
    ["", "invalid-url"],
    ["   ", "invalid-url"],
    ["https://user:secret@themes.example.com/a.json", "invalid-url"],
    [`https://themes.example.com/${"a".repeat(2_100)}`, "invalid-url"],
  ])("refuses %s as %s", (url, code) => {
    expect(checkThemeFetchUrl(url)).toEqual({ ok: false, code });
  });

  it.each([
    "https://localhost/theme.json",
    "https://themes.localhost/theme.json",
    "https://127.0.0.1/theme.json",
    "https://192.168.1.20/theme.json",
    "https://[::1]/theme.json",
    "https://[fe80::1]/theme.json",
  ])("refuses the local or private host of %s", (url) => {
    expect(checkThemeFetchUrl(url)).toEqual({ ok: false, code: "refused-host" });
  });

  it("refuses non-string input", () => {
    expect(checkThemeFetchUrl(42)).toEqual({ ok: false, code: "invalid-url" });
    expect(checkThemeFetchUrl(null)).toEqual({ ok: false, code: "invalid-url" });
  });

  it("keeps the byte limit equal to the theme JSON limit", () => {
    expect(THEME_FETCH_MAX_BYTES).toBe(MAX_THEME_JSON_LENGTH);
    expect(THEME_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});

describe("fetchThemeDocumentText", () => {
  it("returns a valid theme document; the network stack follows redirects under the hop guard", async () => {
    const fetch = fakeFetch({ [URL_A]: () => new Response(THEME_JSON, { status: 200 }) });
    const result = await fetchThemeDocumentText(URL_A, { fetch });
    expect(result).toEqual({ ok: true, value: { text: THEME_JSON, url: URL_A } });
    expect(fetch.calls[0]!.init).toMatchObject({
      method: "GET",
      redirect: "follow",
      credentials: "omit",
    });
    expect(isThemeFetchResult(result)).toBe(true);
  });

  it("never contacts the network for a refused link", async () => {
    const fetch = fakeFetch({});
    await expect(
      fetchThemeDocumentText("http://themes.example.com/a.json", { fetch }),
    ).resolves.toEqual({ ok: false, error: { code: "not-https" } });
    // A local or private host is a generic "could not download", like any other failure.
    for (const url of ["https://localhost:8080/a.json", "https://10.0.0.5/a.json"]) {
      await expect(fetchThemeDocumentText(url, { fetch })).resolves.toEqual({
        ok: false,
        error: { code: "network" },
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a redirect hop the guard refused, and a redirect the stack did not follow", async () => {
    const refused = vi.fn<ThemeFetchFn>(() => Promise.reject(new ThemeFetchHopRefused()));
    await expect(fetchThemeDocumentText(URL_A, { fetch: refused })).resolves.toEqual({
      ok: false,
      error: { code: "redirect" },
    });
    const bare = fakeFetch({ [URL_A]: () => new Response(null, { status: 302 }) });
    await expect(fetchThemeDocumentText(URL_A, { fetch: bare })).resolves.toEqual({
      ok: false,
      error: { code: "redirect" },
    });
  });

  it("refuses a body whose declared size is over the limit without reading it", async () => {
    const body = streamOf([new TextEncoder().encode(THEME_JSON)]);
    const cancel = vi.spyOn(body, "cancel");
    const fetch = fakeFetch({
      [URL_A]: () => new Response(body, { headers: { "content-length": String(40_000) } }),
    });
    await expect(fetchThemeDocumentText(URL_A, { fetch })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("stops reading a streamed body once it passes the limit", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(8_192).fill(32));
      },
    });
    const fetch = fakeFetch({ [URL_A]: () => new Response(endless) });
    await expect(fetchThemeDocumentText(URL_A, { fetch })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
    expect(pulls).toBeLessThan(10);
  });

  it("accepts a body of exactly the limit and rejects one byte more", async () => {
    const padded = THEME_JSON.padEnd(THEME_FETCH_MAX_BYTES, " ");
    const exact = fakeFetch({ [URL_A]: () => new Response(padded) });
    await expect(fetchThemeDocumentText(URL_A, { fetch: exact })).resolves.toMatchObject({
      ok: true,
    });
    const over = fakeFetch({ [URL_A]: () => new Response(`${padded} `) });
    await expect(fetchThemeDocumentText(URL_A, { fetch: over })).resolves.toEqual({
      ok: false,
      error: { code: "too-large" },
    });
  });

  it("times out when the server never answers", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<ThemeFetchFn>(() => new Promise<Response>(() => {}));
    const pending = fetchThemeDocumentText(URL_A, { fetch });
    await vi.advanceTimersByTimeAsync(THEME_FETCH_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ ok: false, error: { code: "timeout" } });
    expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
  });

  it("times out when the body stalls after the headers", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const fetch = fakeFetch({ [URL_A]: () => new Response(stalled) });
    const pending = fetchThemeDocumentText(URL_A, { fetch, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ ok: false, error: { code: "timeout" } });
  });

  it.each([
    ["future schema", JSON.stringify({ ...JSON.parse(THEME_JSON), version: 2 })],
    ["missing palettes", JSON.stringify({ version: 1, label: "Broken" })],
    ["not JSON", "<html>Not a theme</html>"],
    ["blank name", JSON.stringify({ ...JSON.parse(THEME_JSON), label: "  " })],
  ])("refuses a body that is not a v1 theme (%s)", async (_name, body) => {
    const fetch = fakeFetch({ [URL_A]: () => new Response(body) });
    await expect(fetchThemeDocumentText(URL_A, { fetch })).resolves.toEqual({
      ok: false,
      error: { code: "not-theme" },
    });
  });

  it("refuses invalid UTF-8", async () => {
    const fetch = fakeFetch({ [URL_A]: () => new Response(new Uint8Array([0x7b, 0xff, 0x7d])) });
    await expect(fetchThemeDocumentText(URL_A, { fetch })).resolves.toEqual({
      ok: false,
      error: { code: "not-theme" },
    });
  });

  it("reports error answers and network failures as one generic code, echoing nothing", async () => {
    for (const status of [401, 404, 500, 503]) {
      const body = new Response(`secret page ${status}`, {
        status,
        headers: { "x-internal": "yes" },
      });
      const answer = fakeFetch({ [URL_A]: () => body });
      const result = await fetchThemeDocumentText(URL_A, { fetch: answer });
      expect(result).toEqual({ ok: false, error: { code: "network" } });
      expect(JSON.stringify(result)).not.toMatch(new RegExp(`${status}|secret|internal`));
      // The unread body is released, not buffered.
      expect(body.bodyUsed).toBe(true);
    }
    await expect(fetchThemeDocumentText(URL_A, { fetch: fakeFetch({}) })).resolves.toEqual({
      ok: false,
      error: { code: "network" },
    });
  });
});

describe("createThemeHopGuard", () => {
  it("lets the first request and up to the redirect limit through, per request", () => {
    const guard = createThemeHopGuard();
    for (let hop = 0; hop <= THEME_FETCH_MAX_REDIRECTS; hop++) {
      expect(guard.allow({ id: 1, url: `https://cdn${hop}.example.com/t.json` })).toBe(true);
    }
    expect(guard.allow({ id: 1, url: "https://cdn9.example.com/t.json" })).toBe(false);
    // Another request starts its own count, and a finished one is forgotten.
    expect(guard.allow({ id: 2, url: URL_A })).toBe(true);
    guard.forget(1);
    expect(guard.allow({ id: 1, url: URL_A })).toBe(true);
  });

  it.each([
    "http://cdn.example.com/t.json",
    "https://localhost/t.json",
    "https://127.0.0.1/t.json",
    "https://172.16.0.1/t.json",
    "https://169.254.169.254/latest/meta-data",
    "https://[::ffff:192.168.0.1]/t.json",
  ])("refuses a hop to %s", (url) => {
    const guard = createThemeHopGuard();
    expect(guard.allow({ id: 1, url: URL_A })).toBe(true);
    expect(guard.allow({ id: 1, url })).toBe(false);
  });
});

describe("theme fetch IPC handler", () => {
  it("refuses work past the concurrency cap and recovers afterwards", async () => {
    const gate = Promise.withResolvers<Response>();
    const fetch = vi.fn<ThemeFetchFn>(() => gate.promise);
    const handle = createThemeFetchHandler({ fetch, maxConcurrent: 1 });
    const first = handle(URL_A);
    await expect(handle(URL_A)).resolves.toEqual({ ok: false, error: { code: "busy" } });
    gate.resolve(new Response(THEME_JSON));
    await expect(first).resolves.toMatchObject({ ok: true });
    fetch.mockImplementation(async () => new Response(THEME_JSON));
    await expect(handle(URL_A)).resolves.toMatchObject({ ok: true });
  });

  it("serves only a window's main frame", () => {
    const main = { routingId: 1, processId: 7 };
    expect(isThemeFetchMainFrameSender({ senderFrame: main, sender: { mainFrame: main } })).toBe(
      true,
    );
    expect(
      isThemeFetchMainFrameSender({
        senderFrame: { routingId: 2, processId: 7 },
        sender: { mainFrame: main },
      }),
    ).toBe(false);
    expect(isThemeFetchMainFrameSender({ senderFrame: null, sender: { mainFrame: main } })).toBe(
      false,
    );
  });
});

describe("isThemeFetchResult", () => {
  it("accepts only well-formed replies", () => {
    expect(isThemeFetchResult({ ok: true, value: { text: "{}", url: URL_A } })).toBe(true);
    expect(isThemeFetchResult({ ok: false, error: { code: "timeout" } })).toBe(true);
    expect(isThemeFetchResult({ ok: false, error: { code: "teapot" } })).toBe(false);
    expect(isThemeFetchResult({ ok: true, value: { text: 1, url: URL_A } })).toBe(false);
    expect(
      isThemeFetchResult({
        ok: true,
        value: { text: "x".repeat(THEME_FETCH_MAX_BYTES + 1), url: URL_A },
      }),
    ).toBe(false);
    expect(isThemeFetchResult(null)).toBe(false);
  });

  it("rebuilds a reply from its known fields only", () => {
    expect(
      readThemeFetchResult({ ok: false, error: { code: "network", status: 500, body: "x" } }),
    ).toEqual({ ok: false, error: { code: "network" } });
    expect(readThemeFetchResult({ ok: false, error: { code: "http-error", status: 404 } })).toBe(
      null,
    );
  });
});
