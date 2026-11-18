/**
 * ViscosityCode: download one theme document for "Import from URL…".
 *
 * Free of Electron imports so it runs under unit tests with a fake `fetch`;
 * `registerThemeFetchIpc.ts` wires it to Electron's `net.fetch` (a dedicated
 * session's `fetch`), which uses Chromium's network stack: the system proxy
 * and the OS certificate store.
 *
 * - https only, no credentials in the URL, and never `localhost` or a literal
 *   loopback / private / link-local IP (`themeFetchHosts.ts`).
 * - Redirects are followed by the network stack, so the same rules are
 *   enforced on every hop by a hop guard on the session (`createThemeHopGuard`,
 *   at most `THEME_FETCH_MAX_REDIRECTS` hops). A refused hop surfaces as
 *   `ThemeFetchHopRefused`.
 * - The body is read up to `THEME_FETCH_MAX_BYTES`; a larger declared or
 *   actual body is refused without buffering the rest.
 * - One deadline covers redirects, headers and body.
 * - Only text that `parseThemeDocument` accepts is returned, so the channel
 *   cannot be used to read anything other than a valid theme, and nothing about
 *   a failed answer (status, headers, body) is passed back: those failures are
 *   the generic `network` code.
 */
import { parseThemeDocument } from "@/shared/customThemes";
import {
  THEME_FETCH_MAX_BYTES,
  THEME_FETCH_MAX_REDIRECTS,
  THEME_FETCH_TIMEOUT_MS,
  THEME_URL_MAX_LENGTH,
  themeFetchFail,
  type ThemeFetchResult,
} from "./themeFetchContract";
import { isRefusedThemeHost } from "./themeFetchHosts";

export type ThemeFetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ThemeFetchOptions {
  fetch: ThemeFetchFn;
  timeoutMs?: number;
  maxBytes?: number;
}

export type ThemeUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; code: "invalid-url" | "not-https" | "refused-host" };

/** The URL rules, shared by the first request and every redirect hop. */
export function checkThemeFetchUrl(raw: unknown): ThemeUrlCheck {
  if (typeof raw !== "string") return { ok: false, code: "invalid-url" };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > THEME_URL_MAX_LENGTH) return { ok: false, code: "invalid-url" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "not-https" };
  if (!url.hostname || url.username || url.password) return { ok: false, code: "invalid-url" };
  if (isRefusedThemeHost(url.hostname)) return { ok: false, code: "refused-host" };
  url.hash = "";
  return { ok: true, url };
}

/** Thrown by the fetch when the hop guard refused a redirect hop. */
export class ThemeFetchHopRefused extends Error {
  constructor() {
    super("A redirect hop of the theme download was refused.");
    this.name = "ThemeFetchHopRefused";
  }
}

/** Per-request hop policy for the download session's `onBeforeRequest`. */
export interface ThemeHopGuard {
  /** Whether this hop (the first request or a redirect) may go ahead. */
  allow(details: { id: number; url: string }): boolean;
  /** The request finished or failed. */
  forget(id: number): void;
}

/** Requests remembered at most, in case a completion event never arrives. */
const HOP_GUARD_MAX_TRACKED = 64;

export function createThemeHopGuard(maxRedirects = THEME_FETCH_MAX_REDIRECTS): ThemeHopGuard {
  // Request id → hops taken so far; insertion order is least recently seen first.
  const hops = new Map<number, number>();
  return {
    allow({ id, url }) {
      const hop = (hops.get(id) ?? -1) + 1;
      hops.delete(id);
      hops.set(id, hop);
      for (const oldest of hops.keys()) {
        if (hops.size <= HOP_GUARD_MAX_TRACKED) break;
        hops.delete(oldest);
      }
      return hop <= maxRedirects && checkThemeFetchUrl(url).ok;
    },
    forget(id) {
      hops.delete(id);
    },
  };
}

class ThemeFetchTimeout extends Error {}

/** Settles with `promise`, or rejects as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(new ThemeFetchTimeout());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ThemeFetchTimeout());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {});
}

/** The body as bytes, or `null` once it grows past `maxBytes`. */
async function readCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await untilAborted(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isRedirectAnswer(response: Response): boolean {
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

export async function fetchThemeDocumentText(
  rawUrl: unknown,
  options: ThemeFetchOptions,
): Promise<ThemeFetchResult> {
  const checked = checkThemeFetchUrl(rawUrl);
  if (!checked.ok) {
    // A refused host says no more than any other failed download.
    return themeFetchFail(checked.code === "refused-host" ? "network" : checked.code);
  }
  const url = checked.url;
  const maxBytes = options.maxBytes ?? THEME_FETCH_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? THEME_FETCH_TIMEOUT_MS);
  const { signal } = controller;
  try {
    const response = await untilAborted(
      options.fetch(url.href, {
        method: "GET",
        redirect: "follow",
        credentials: "omit",
        signal,
        headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.5" },
      }),
      signal,
    );
    // A redirect the network stack did not follow (no usable location).
    if (isRedirectAnswer(response)) {
      discardBody(response);
      return themeFetchFail("redirect");
    }
    if (!response.ok) {
      discardBody(response);
      return themeFetchFail("network");
    }
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      discardBody(response);
      return themeFetchFail("too-large");
    }
    const bytes = await readCapped(response, maxBytes, signal);
    if (!bytes) return themeFetchFail("too-large");
    const text = decodeUtf8(bytes);
    if (text === null || !parseThemeDocument(text)) return themeFetchFail("not-theme");
    return { ok: true, value: { text, url: url.href } };
  } catch (error) {
    if (error instanceof ThemeFetchTimeout || signal.aborted) return themeFetchFail("timeout");
    if (error instanceof ThemeFetchHopRefused) return themeFetchFail("redirect");
    return themeFetchFail("network");
  } finally {
    clearTimeout(timer);
    if (!signal.aborted) controller.abort();
  }
}
