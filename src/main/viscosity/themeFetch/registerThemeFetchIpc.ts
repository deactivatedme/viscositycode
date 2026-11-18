/**
 * ViscosityCode: Electron wiring for "Import theme from URL…".
 *
 * Registers the fork-owned `viscosity:theme:fetch` channel (not part of the
 * upstream IPC procedure map). Downloads run on Electron's `net.fetch` in a
 * dedicated in-memory session whose every hop passes the theme hop guard
 * (see `themeFetchSession.ts`). The session is created on first use, after
 * the app is ready.
 */
import { ipcMain, session } from "electron";
import { THEME_FETCH_IPC, themeFetchFail } from "./themeFetchContract";
import { createThemeHopGuard } from "./themeFetch";
import { createThemeFetchHandler, isThemeFetchMainFrameSender } from "./themeFetchIpc";
import {
  createThemeSessionFetch,
  installThemeHopGuard,
  THEME_FETCH_PARTITION,
  type ThemeFetchSession,
} from "./themeFetchSession";

let registered = false;
let themeSession: ThemeFetchSession | undefined;

function themeFetchSession(): ThemeFetchSession {
  if (!themeSession) {
    const created = session.fromPartition(THEME_FETCH_PARTITION, { cache: false });
    installThemeHopGuard(created, createThemeHopGuard());
    themeSession = created;
  }
  return themeSession;
}

/** Idempotent: registers the handler once per process. */
export function registerViscosityThemeFetchIpc(): void {
  if (registered) return;
  registered = true;
  const handle = createThemeFetchHandler({ fetch: createThemeSessionFetch(themeFetchSession) });
  ipcMain.handle(THEME_FETCH_IPC.fetch, (event, url: unknown) =>
    isThemeFetchMainFrameSender(event) ? handle(url) : themeFetchFail("unavailable"),
  );
}
