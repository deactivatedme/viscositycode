/**
 * ViscosityCode: the Electron wiring of `viscosity:live-re:environment`.
 * Only an app window's main frame may run the probe.
 */
import { ipcMain } from "electron";
import { liveReBinaryPath } from "@/shared/viscosity/liveReBinary";
import { isThemeFetchMainFrameSender as isMainFrameSender } from "../themeFetch/themeFetchIpc";
import { LIVE_RE_IPC } from "./liveReContract";
import { createLiveReEnvironmentProbe } from "./liveReEnvironment";

let registered = false;

/** Idempotent: registers the handler once per process. */
export function registerViscosityLiveReIpc(helpersDir: string): void {
  if (registered) return;
  registered = true;
  const probe = createLiveReEnvironmentProbe({
    binaryPath: () => liveReBinaryPath({ helpersDir }),
  });
  ipcMain.handle(LIVE_RE_IPC.environment, (event) =>
    isMainFrameSender(event) ? probe() : { status: "error", code: "unavailable" },
  );
}
