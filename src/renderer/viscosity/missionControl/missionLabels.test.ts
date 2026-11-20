import { describe, expect, it } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { formatAge } from "./missionClock";
import { countGridColumns, nextGridIndex } from "./missionGridNav";
import {
  missionFilterLabel,
  missionFxState,
  missionStateLabel,
  missionTimeLabel,
} from "./missionLabels";
import type { MissionCard, RoundtableMissionCard, ThreadMissionCard } from "./missionModel";

const NOW = 1_000_000_000;

function threadCard(overrides: Partial<ThreadMissionCard> = {}): ThreadMissionCard {
  return {
    kind: "thread",
    key: "thread:t1",
    threadId: "t1",
    agentKind: "agent-x",
    presentation: "gui",
    remoteServerId: undefined,
    attentionKind: undefined,
    errorText: undefined,
    state: "working",
    title: "Fix it",
    projectId: "p1",
    activityAt: NOW,
    startedAt: undefined,
    endedAt: undefined,
    canStop: true,
    ...overrides,
  };
}

function roundtableCard(overrides: Partial<RoundtableMissionCard> = {}): RoundtableMissionCard {
  return {
    kind: "roundtable",
    key: "roundtable:rt1",
    sessionId: "rt1",
    status: "running",
    pattern: "build-review",
    reviewThreadId: undefined,
    state: "working",
    title: "Debate",
    projectId: "p1",
    activityAt: NOW,
    startedAt: undefined,
    endedAt: undefined,
    canStop: true,
    ...overrides,
  };
}

describe("missionFxState", () => {
  it("uses the shared agent-state names and refines working cards", () => {
    expect(missionFxState({ state: "working" }, "tool")).toBe("tool");
    expect(missionFxState({ state: "working" }, null)).toBe("working");
    expect(missionFxState({ state: "attention" }, "tool")).toBe("attention");
    expect(missionFxState({ state: "error" }, null)).toBe("error");
    expect(missionFxState({ state: "done" }, null)).toBe("idle");
  });
});

describe("missionStateLabel", () => {
  it("names what the agent is doing or waiting for", () => {
    const label = (card: MissionCard, live: Parameters<typeof missionStateLabel>[1] = null) =>
      missionStateLabel(card, live, i18n);
    expect(label(threadCard(), "thinking")).toBe("Thinking");
    expect(label(threadCard(), "tool")).toBe("Running a tool");
    expect(label(threadCard(), "streaming")).toBe("Writing");
    expect(label(threadCard())).toBe("Working");
    expect(label(threadCard({ state: "attention", attentionKind: "approval" }))).toBe(
      "Needs approval",
    );
    expect(label(threadCard({ state: "attention", attentionKind: "reply" }))).toBe(
      "Needs your reply",
    );
    expect(label(roundtableCard({ state: "attention" }))).toBe("Waiting for you");
    expect(label(roundtableCard({ state: "idle", status: "paused" }))).toBe("Paused");
    expect(label(roundtableCard({ state: "idle", pattern: "open" }))).toBe("Ready");
    expect(label(roundtableCard({ state: "idle" }))).toBe("Idle");
    expect(label(threadCard({ state: "done" }))).toBe("Done");
    expect(label(threadCard({ state: "error" }))).toBe("Error");
  });
});

describe("missionTimeLabel", () => {
  it("shows the running time, then how long ago the work finished", () => {
    expect(missionTimeLabel(threadCard({ startedAt: NOW - 125_000 }), NOW, i18n)).toBe(
      "Running 2m",
    );
    expect(
      missionTimeLabel(threadCard({ state: "attention", startedAt: NOW - 125_000 }), NOW, i18n),
    ).toBe("Started 2m ago");
    expect(missionTimeLabel(threadCard({ state: "done", endedAt: NOW - 30_000 }), NOW, i18n)).toBe(
      "Finished just now",
    );
    expect(
      missionTimeLabel(threadCard({ state: "done", endedAt: NOW - 3 * 3_600_000 }), NOW, i18n),
    ).toBe("Finished 3h ago");
    expect(
      missionTimeLabel(threadCard({ state: "error", endedAt: NOW - 5 * 60_000 }), NOW, i18n),
    ).toBe("Last active 5m ago");
    expect(missionTimeLabel(threadCard(), NOW, i18n)).toBeNull();
  });

  it("formats compact ages", () => {
    expect(formatAge(-5)).toBe("0s");
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(2 * 86_400_000)).toBe("2d");
  });
});

describe("missionFilterLabel", () => {
  it("labels every filter", () => {
    expect(
      (["all", "needs", "working", "errors", "done"] as const).map((filter) =>
        missionFilterLabel(filter, i18n),
      ),
    ).toEqual(["All", "Needs you", "Working", "Errors", "Done"]);
  });
});

describe("grid keyboard model", () => {
  it("moves by one, by a row, and to the ends", () => {
    expect(nextGridIndex("ArrowRight", 0, 5, 3)).toBe(1);
    expect(nextGridIndex("ArrowLeft", 0, 5, 3)).toBeNull();
    expect(nextGridIndex("ArrowDown", 1, 5, 3)).toBe(4);
    expect(nextGridIndex("ArrowDown", 2, 5, 3)).toBeNull();
    expect(nextGridIndex("ArrowUp", 4, 5, 3)).toBe(1);
    expect(nextGridIndex("Home", 3, 5, 3)).toBe(0);
    expect(nextGridIndex("End", 1, 5, 3)).toBe(4);
    expect(nextGridIndex("End", 4, 5, 3)).toBeNull();
    expect(nextGridIndex("Enter", 1, 5, 3)).toBeNull();
    expect(nextGridIndex("ArrowRight", 0, 0, 3)).toBeNull();
  });

  it("counts the columns of the first row", () => {
    expect(countGridColumns([10, 10, 10, 140, 140])).toBe(3);
    expect(countGridColumns([0])).toBe(1);
    expect(countGridColumns([])).toBe(1);
  });
});
