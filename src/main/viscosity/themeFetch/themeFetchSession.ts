/**
 * ViscosityCode: the Electron session behind "Import theme from URL…".
 *
 * Downloads use Electron's `net.fetch` on a dedicated in-memory session
 * (`ses.fetch`): Chromium's network stack, so the system proxy and the OS
 * certificate store apply, and no cookies or cache are shared with the app.
 * Electron's `net.fetch` cannot hand back a redirect for inspection
 * (`redirect: "manual"` fails with "Redirect was cancelled"), so redirects
 * are followed by the stack and every hop passes the session's
 * `webRequest.onBeforeRequest` hop guard instead. A hop the guard cancels
 * fails the fetch with `net::ERR_BLOCKED_BY_CLIENT`, reported as
 * `ThemeFetchHopRefused`.
 *
 * Electron-free (structural types only) so it runs under unit tests.
 */
import { ThemeFetchHopRefused, type ThemeFetchFn, type ThemeHopGuard } from "./themeFetch";
import { resolvesToPublicThemeHost, type ThemeHostLookup } from "./themeFetchHosts";

/** Not "persist:": the session lives in memory only. */
export const THEME_FETCH_PARTITION = "viscosity-theme-fetch";

interface RequestDetails {
  id: number;
  url: string;
}

/** The slice of an Electron `Session` this feature uses. */
export interface ThemeFetchSession {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  webRequest: {
    onBeforeRequest(
      listener: (
        details: RequestDetails,
        callback: (response: { cancel?: boolean }) => void,
      ) => void,
    ): void;
    onCompleted(listener: (details: RequestDetails) => void): void;
    onErrorOccurred(listener: (details: RequestDetails) => void): void;
  };
}

/**
 * Enforces the hop policy on every request of the (dedicated) session, and
 * resolves each hop's host name so one that points at a local or private
 * address is refused too. Each webRequest event takes one listener per
 * session, so the session must not be shared with anything else.
 */
export function installThemeHopGuard(
  session: ThemeFetchSession,
  guard: ThemeHopGuard,
  lookup: ThemeHostLookup,
): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    if (!guard.allow(details)) {
      callback({ cancel: true });
      return;
    }
    resolvesToPublicThemeHost(new URL(details.url).hostname, lookup).then(
      (allowed) => callback({ cancel: !allowed }),
      () => callback({ cancel: true }),
    );
  });
  session.webRequest.onCompleted((details) => guard.forget(details.id));
  session.webRequest.onErrorOccurred((details) => guard.forget(details.id));
}

const HOP_REFUSED_ERROR = "ERR_BLOCKED_BY_CLIENT";

function isHopRefusal(error: unknown): boolean {
  return error instanceof Error && error.message.includes(HOP_REFUSED_ERROR);
}

/** `net.fetch` on the guarded session, with a refused hop as `ThemeFetchHopRefused`. */
export function createThemeSessionFetch(getSession: () => ThemeFetchSession): ThemeFetchFn {
  return async (url, init) => {
    try {
      return await getSession().fetch(url, init);
    } catch (error) {
      if (isHopRefusal(error)) throw new ThemeFetchHopRefused();
      throw error;
    }
  };
}
