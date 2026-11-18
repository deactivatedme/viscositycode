/**
 * ViscosityCode: request handling behind `viscosity:theme:fetch`. Free of
 * Electron imports so it can be tested with fakes; `registerThemeFetchIpc.ts`
 * does the wiring.
 */
import {
  THEME_FETCH_MAX_CONCURRENT,
  themeFetchFail,
  type ThemeFetchResult,
} from "./themeFetchContract";
import { fetchThemeDocumentText, type ThemeFetchOptions } from "./themeFetch";

export interface ThemeFetchHandlerOptions extends ThemeFetchOptions {
  maxConcurrent?: number;
}

/** Downloads one theme per call, refusing work past the concurrency cap. */
export function createThemeFetchHandler(
  options: ThemeFetchHandlerOptions,
): (url: unknown) => Promise<ThemeFetchResult> {
  const maxConcurrent = options.maxConcurrent ?? THEME_FETCH_MAX_CONCURRENT;
  let active = 0;
  return async (url) => {
    if (active >= maxConcurrent) return themeFetchFail("busy");
    active++;
    try {
      return await fetchThemeDocumentText(url, options);
    } finally {
      active--;
    }
  };
}

/** Only an app window's main frame may download themes (never a subframe). */
export function isThemeFetchMainFrameSender(event: {
  senderFrame: { routingId: number; processId: number } | null;
  sender: { mainFrame: { routingId: number; processId: number } | null };
}): boolean {
  const frame = event.senderFrame;
  const main = event.sender.mainFrame;
  return (
    frame !== null &&
    main !== null &&
    frame.routingId === main.routingId &&
    frame.processId === main.processId
  );
}
