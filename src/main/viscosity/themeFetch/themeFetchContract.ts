/**
 * ViscosityCode: wire contract for the fork-owned theme download channel
 * (`window.viscosityHost.themes`). Pure module: it is bundled into both the
 * main process and the sandboxed preload, and it is not part of the upstream
 * IPC procedure map.
 *
 * The renderer cannot fetch arbitrary https links itself (the packaged window
 * loads from `file:`, so cross-origin reads depend on each server's CORS
 * headers). Main downloads instead, under the same rules the renderer shows:
 * https only, at most 32 KB, 10 seconds, and only a valid version 1 theme
 * document is ever handed back. Nothing about the server's answer (status
 * code, headers, a rejected body) crosses back: every server-side failure is
 * the generic "could not download" code, `network`.
 *
 * Main and preload ship in the same bundle, so this contract has no version:
 * a reply the preload does not recognise is reported as `network`.
 */
export const THEME_FETCH_IPC = { fetch: "viscosity:theme:fetch" } as const;

/**
 * Largest accepted response body, in bytes: `MAX_THEME_JSON_LENGTH` from
 * `@/shared/customThemes`, written out so the preload bundle stays free of
 * zod (a test keeps the two equal).
 */
export const THEME_FETCH_MAX_BYTES = 32_768;
/** One import, redirects and body included, must finish within this. */
export const THEME_FETCH_TIMEOUT_MS = 10_000;
/** Each hop must stay on https. */
export const THEME_FETCH_MAX_REDIRECTS = 3;
export const THEME_URL_MAX_LENGTH = 2_048;
export const THEME_FETCH_MAX_CONCURRENT = 4;

export type ThemeFetchErrorCode =
  | "invalid-url"
  | "not-https"
  | "redirect"
  | "too-large"
  | "timeout"
  /** Generic "could not download": network failures, error answers, refused hosts. */
  | "network"
  | "not-theme"
  | "busy"
  | "unavailable";

export const THEME_FETCH_ERROR_CODES: readonly ThemeFetchErrorCode[] = [
  "invalid-url",
  "not-https",
  "redirect",
  "too-large",
  "timeout",
  "network",
  "not-theme",
  "busy",
  "unavailable",
];

export interface ThemeFetchFailure {
  code: ThemeFetchErrorCode;
}

export type ThemeFetchResult =
  | { ok: true; value: { text: string; url: string } }
  | { ok: false; error: ThemeFetchFailure };

/** Preload namespace shape (`window.viscosityHost.themes`). */
export interface ViscosityThemeFetchBridge {
  readonly available: true;
  fetchTheme(url: string): Promise<ThemeFetchResult>;
}

export function themeFetchFail(code: ThemeFetchErrorCode): ThemeFetchResult {
  return { ok: false, error: { code } };
}

const KNOWN_CODES: ReadonlySet<string> = new Set(THEME_FETCH_ERROR_CODES);

/**
 * Reads a reply crossing the IPC or context-bridge boundary: a fresh result
 * with only the known fields, or `null` when it is not a well-formed reply.
 */
export function readThemeFetchResult(value: unknown): ThemeFetchResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { ok?: unknown; value?: unknown; error?: unknown };
  if (record.ok === true) {
    const payload = record.value as { text?: unknown; url?: unknown } | null | undefined;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.text !== "string" ||
      payload.text.length > THEME_FETCH_MAX_BYTES ||
      typeof payload.url !== "string"
    ) {
      return null;
    }
    return { ok: true, value: { text: payload.text, url: payload.url } };
  }
  if (record.ok !== false || !record.error || typeof record.error !== "object") return null;
  const code = (record.error as { code?: unknown }).code;
  return typeof code === "string" && KNOWN_CODES.has(code)
    ? themeFetchFail(code as ThemeFetchErrorCode)
    : null;
}

/** Shape check for replies crossing the IPC and context-bridge boundaries. */
export function isThemeFetchResult(value: unknown): value is ThemeFetchResult {
  return readThemeFetchResult(value) !== null;
}
