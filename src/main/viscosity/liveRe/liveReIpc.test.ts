// ViscosityCode: the live_re setup-check channel and its preload bridge.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_RE_IPC } from "./liveReContract";
import { createViscosityLiveRePreloadBridge } from "./liveRePreloadBridge";

type Handler = (event: unknown) => unknown;
const electron = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn<(channel: string, listener: Handler) => void>((channel, listener) => {
      handlers.set(channel, listener);
    }),
  };
});
vi.mock("electron", () => ({ ipcMain: { handle: electron.handle } }));

import { registerViscosityLiveReIpc } from "./registerLiveReIpc";

const mainFrame = { routingId: 1, processId: 7 };

describe("registerViscosityLiveReIpc", () => {
  beforeEach(() => {
    vi.stubEnv("VISCOSITY_LIVE_RE_BIN", "/definitely/missing/viscosity-live-re");
  });

  it("registers once and refuses senders other than the main frame", async () => {
    registerViscosityLiveReIpc("/no/helpers");
    registerViscosityLiveReIpc("/no/helpers");
    expect(electron.handle).toHaveBeenCalledTimes(1);
    const handler = electron.handlers.get(LIVE_RE_IPC.environment);
    if (!handler) throw new Error("channel not registered");
    expect(
      await handler({ senderFrame: { routingId: 2, processId: 7 }, sender: { mainFrame } }),
    ).toEqual({ status: "error", code: "unavailable" });
    expect(await handler({ senderFrame: mainFrame, sender: { mainFrame } })).toEqual({
      status: "missing",
    });
  });
});

describe("createViscosityLiveRePreloadBridge", () => {
  it("rebuilds replies from known fields and rejects unknown ones", async () => {
    const invoke = vi.fn<(channel: string) => Promise<unknown>>();
    const bridge = createViscosityLiveRePreloadBridge({ invoke } as never);
    invoke.mockResolvedValueOnce({ status: "missing", leaked: "x" });
    expect(await bridge.checkEnvironment()).toEqual({ status: "missing" });
    expect(invoke).toHaveBeenCalledWith(LIVE_RE_IPC.environment);
    invoke.mockResolvedValueOnce({ status: "error", code: "rm -rf" });
    expect(await bridge.checkEnvironment()).toEqual({ status: "error", code: "malformed" });
    invoke.mockResolvedValueOnce({ status: "ok", environment: { environmentVersion: 1 } });
    expect(await bridge.checkEnvironment()).toEqual({ status: "error", code: "malformed" });
  });
});
