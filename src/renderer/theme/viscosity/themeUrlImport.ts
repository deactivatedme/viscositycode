/**
 * ViscosityCode: "Import theme from URL…" in the renderer.
 *
 * The page validates the link for immediate feedback, then asks the desktop
 * main process to download it (`window.viscosityHost.themes`, see
 * `src/main/viscosity/themeFetch/`), because the packaged window loads from
 * `file:` and most servers do not allow cross-origin reads. Main applies the
 * same rules again (https only, 32 KB, 10 s, theme schema). Whatever comes
 * back is parsed here with `parseThemeDocument` before anything can be saved.
 * Clients without the bridge (web, PWA, extension) do not offer the action.
 */
import {
  MAX_THEME_JSON_LENGTH,
  parseThemeDocument,
  type ThemeDocument,
} from "@/shared/customThemes";

/** Same limits as the main-process download. */
export const THEME_URL_MAX_BYTES = MAX_THEME_JSON_LENGTH;
export const THEME_URL_TIMEOUT_MS = 10_000;
export const THEME_URL_MAX_LENGTH = 2_048;
/** Extra wait for the IPC reply beyond main's own deadline. */
const BRIDGE_REPLY_GRACE_MS = 2_000;

export type ThemeUrlErrorCode =
  | "empty"
  | "invalid-url"
  | "not-https"
  | "redirect"
  | "too-large"
  | "timeout"
  | "http-error"
  | "network"
  | "not-theme"
  | "busy"
  | "unavailable";

const BRIDGE_CODES: ReadonlySet<string> = new Set<ThemeUrlErrorCode>([
  "invalid-url",
  "not-https",
  "redirect",
  "too-large",
  "timeout",
  "http-error",
  "network",
  "not-theme",
  "busy",
  "unavailable",
]);

export type ThemeUrlCheck =
  | { ok: true; url: string }
  | { ok: false; code: "empty" | "invalid-url" | "not-https" };

/** https only, no credentials, a host, and a sane length. */
export function checkThemeUrl(raw: string): ThemeUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, code: "empty" };
  if (trimmed.length > THEME_URL_MAX_LENGTH) return { ok: false, code: "invalid-url" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "not-https" };
  if (!url.hostname || url.username || url.password) return { ok: false, code: "invalid-url" };
  url.hash = "";
  return { ok: true, url: url.href };
}

/** The renderer's view of `window.viscosityHost.themes`. */
export interface ThemeFetchBridge {
  fetchTheme(url: string): Promise<unknown>;
}

/** The desktop download bridge, or `null` on clients that do not have one. */
export function readThemeFetchBridge(): ThemeFetchBridge | null {
  if (typeof window === "undefined") return null;
  const host: unknown = window.viscosityHost;
  if (!host || typeof host !== "object") return null;
  const themes: unknown = Reflect.get(host, "themes");
  if (!themes || typeof themes !== "object") return null;
  const fetchTheme: unknown = Reflect.get(themes, "fetchTheme");
  if (typeof fetchTheme !== "function") return null;
  return { fetchTheme: (url) => Reflect.apply(fetchTheme, themes, [url]) as Promise<unknown> };
}

export type ThemeUrlImportResult =
  | { ok: true; doc: ThemeDocument; url: string }
  | { ok: false; code: ThemeUrlErrorCode; status?: number };

function failure(code: ThemeUrlErrorCode, status?: unknown): ThemeUrlImportResult {
  return typeof status === "number" ? { ok: false, code, status } : { ok: false, code };
}

/** Reads a bridge reply defensively: anything unexpected is a network failure. */
function readBridgeReply(reply: unknown, requestedUrl: string): ThemeUrlImportResult {
  if (!reply || typeof reply !== "object") return failure("network");
  const record = reply as { ok?: unknown; value?: unknown; error?: unknown };
  if (record.ok === false) {
    const error = record.error as { code?: unknown; status?: unknown } | null | undefined;
    const code = error && typeof error.code === "string" ? error.code : "";
    return BRIDGE_CODES.has(code)
      ? failure(code as ThemeUrlErrorCode, error?.status)
      : failure("network");
  }
  if (record.ok !== true) return failure("network");
  const value = record.value as { text?: unknown; url?: unknown } | null | undefined;
  if (!value || typeof value.text !== "string") return failure("network");
  if (value.text.length > THEME_URL_MAX_BYTES) return failure("too-large");
  const doc = parseThemeDocument(value.text);
  if (!doc) return failure("not-theme");
  return { ok: true, doc, url: typeof value.url === "string" ? value.url : requestedUrl };
}

export interface ThemeUrlImportOptions {
  bridge?: ThemeFetchBridge | null;
  /** How long to wait for the bridge before reporting a timeout. */
  replyTimeoutMs?: number;
}

/** Validates, downloads through main, and parses one theme link. */
export async function fetchThemeFromUrl(
  raw: string,
  options: ThemeUrlImportOptions = {},
): Promise<ThemeUrlImportResult> {
  const checked = checkThemeUrl(raw);
  if (!checked.ok) return failure(checked.code);
  const bridge = options.bridge === undefined ? readThemeFetchBridge() : options.bridge;
  if (!bridge) return failure("unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(
      () => resolve("timeout"),
      options.replyTimeoutMs ?? THEME_URL_TIMEOUT_MS + BRIDGE_REPLY_GRACE_MS,
    );
  });
  try {
    const reply = await Promise.race([bridge.fetchTheme(checked.url), timedOut]);
    if (reply === "timeout") return failure("timeout");
    return readBridgeReply(reply, checked.url);
  } catch {
    return failure("network");
  } finally {
    clearTimeout(timer);
  }
}
