/**
 * ViscosityCode: the `window.viscosityHost.themes` bridge built in the
 * preload. Pure (type-only Electron import) so the sandboxed preload bundle
 * stays small. Replies are shape-checked and rebuilt from their known fields
 * before they reach page code.
 */
import type { IpcRenderer } from "electron";
import {
  THEME_FETCH_IPC,
  readThemeFetchResult,
  themeFetchFail,
  type ViscosityThemeFetchBridge,
} from "./themeFetchContract";

export type ThemeFetchPreloadIpc = Pick<IpcRenderer, "invoke">;

export function createViscosityThemePreloadBridge(
  ipc: ThemeFetchPreloadIpc,
): ViscosityThemeFetchBridge {
  return {
    available: true,
    async fetchTheme(url) {
      if (typeof url !== "string") return themeFetchFail("invalid-url");
      const result: unknown = await ipc.invoke(THEME_FETCH_IPC.fetch, url);
      return readThemeFetchResult(result) ?? themeFetchFail("network");
    },
  };
}
