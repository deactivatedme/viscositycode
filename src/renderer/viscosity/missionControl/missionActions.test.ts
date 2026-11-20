import { beforeEach, describe, expect, it, vi } from "vitest";
import { interruptRoundtable, stopRoundtable } from "@/renderer/viscosity/roundtable/api";
import { stopMissionCard } from "./missionActions";
import type { RoundtableMissionCard } from "./missionModel";

vi.mock("@/renderer/viscosity/roundtable/api", () => ({
  interruptRoundtable: vi.fn<(id: string) => Promise<void>>(async () => {}),
  stopRoundtable: vi.fn<(id: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/renderer/viscosity/roundtable/ui/roundtableViewStore", () => ({
  openRoundtableView: vi.fn<() => void>(),
}));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => ({
  activateThreadTab: vi.fn<() => void>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: vi.fn<() => void>() }));

function card(pattern: RoundtableMissionCard["pattern"]): RoundtableMissionCard {
  return {
    kind: "roundtable",
    key: "roundtable:rt1",
    sessionId: "rt1",
    status: "running",
    pattern,
    reviewThreadId: undefined,
    state: "working",
    title: "Chat",
    projectId: "p1",
    activityAt: 0,
    startedAt: undefined,
    endedAt: undefined,
    canStop: true,
  };
}

describe("stopMissionCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stops a team chat's replies without ending it, like its own Stop replies", async () => {
    await stopMissionCard(card("open"));
    expect(interruptRoundtable).toHaveBeenCalledWith("rt1");
    expect(stopRoundtable).not.toHaveBeenCalled();
  });

  it("ends other Roundtables", async () => {
    await stopMissionCard(card("build-review"));
    expect(stopRoundtable).toHaveBeenCalledWith("rt1");
    expect(interruptRoundtable).not.toHaveBeenCalled();
  });
});
