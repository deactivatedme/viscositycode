/**
 * ViscosityCode: the `window.viscosityHost.liveRe` bridge built in the
 * preload. Replies are shape-checked and rebuilt from their known fields
 * before they reach page code.
 */
import type { IpcRenderer } from "electron";
import { readLiveReEnvironmentReply } from "@/shared/viscosity/liveRe";
import { LIVE_RE_IPC, type ViscosityLiveReBridge } from "./liveReContract";

export function createViscosityLiveRePreloadBridge(
  ipc: Pick<IpcRenderer, "invoke">,
): ViscosityLiveReBridge {
  return {
    available: true,
    async checkEnvironment() {
      const reply: unknown = await ipc.invoke(LIVE_RE_IPC.environment);
      return readLiveReEnvironmentReply(reply) ?? { status: "error", code: "malformed" };
    },
  };
}
