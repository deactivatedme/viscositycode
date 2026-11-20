import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { RoundtableSession } from "../types";
import { session, turn } from "./roundtable.testFixtures";
import {
  describeRoundtableProgress,
  displayRound,
  pickStatusSession,
  RoundtableStatusItem,
} from "./RoundtableStatusItem";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({ sessions: new Map<string, RoundtableSession>() }));

vi.mock("../roundtableStore", () => ({
  useRoundtableStore: <T,>(select: (state: { sessions: Record<string, RoundtableSession> }) => T) =>
    select({ sessions: Object.fromEntries(api.sessions) }),
}));

let releaseShell: (() => void) | undefined;

beforeEach(() => {
  api.sessions.clear();
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
});

describe("describeRoundtableProgress", () => {
  it("names the round and who is working", () => {
    const value = session({
      turns: [
        turn("t1", { participantId: "a", round: 0, phase: "build" }),
        turn("t2", { participantId: "b", round: 1, phase: "review", status: "running" }),
      ],
    });
    expect(describeRoundtableProgress(value, i18n)).toEqual({
      label: "Roundtable · round 2/4 · Agent B reviewing",
      tone: "working",
    });
  });

  it("asks for attention while a participant waits for approval or the table is paused", () => {
    const waiting = session({
      turns: [turn("t1", { participantId: "a", round: 0, status: "waiting-approval" })],
    });
    expect(describeRoundtableProgress(waiting, i18n)).toEqual({
      label: "Roundtable · round 1/4 · Agent A needs your approval",
      tone: "attention",
    });
    expect(
      describeRoundtableProgress(
        session({ status: "paused", turns: [turn("t1", { round: 0 })] }),
        i18n,
      ),
    ).toEqual({ label: "Roundtable · round 1/4 · paused", tone: "attention" });
  });

  it("says when it is starting, and shows no round or role in a team chat", () => {
    expect(describeRoundtableProgress(session({ maxRounds: 0 }), i18n).label).toBe(
      "Roundtable · starting",
    );
    const open = session({
      pattern: "open",
      maxRounds: 0,
      turns: [turn("t1", { round: 2, phase: "reply", participantId: "a", status: "running" })],
    });
    expect(describeRoundtableProgress(open, i18n)).toEqual({
      label: "Roundtable · Agent A replying",
      tone: "working",
    });
  });

  it("shows an idle team chat as ready, not working", () => {
    const idle = session({
      pattern: "open",
      maxRounds: 0,
      notes: [{ id: "n1", text: "Hi", createdAt: 1 }],
      turns: [turn("t1", { round: 0, phase: "reply", noteId: "n1" })],
    });
    expect(describeRoundtableProgress(idle, i18n)).toEqual({
      label: "Roundtable · ready",
      tone: "inactive",
    });
  });
});

describe("displayRound", () => {
  it("counts from one and never goes past the limit", () => {
    expect(displayRound({ round: 0, phase: "build" }, 4)).toEqual({ round: 1, max: 4 });
    expect(displayRound({ round: 3, phase: "review" }, 4)).toEqual({ round: 4, max: 4 });
    expect(displayRound({ round: 0 }, 0)).toEqual({ round: 1, max: null });
  });

  it("numbers debate critiques as they are and gives other phases no round", () => {
    expect(displayRound({ round: 0, phase: "propose" }, 2)).toBeNull();
    expect(displayRound({ round: 2, phase: "critique" }, 2)).toEqual({ round: 2, max: 2 });
    expect(displayRound({ round: 3, phase: "decide" }, 2)).toBeNull();
    expect(displayRound({ round: 4, phase: "implement" }, 2)).toBeNull();
    expect(displayRound({ round: 2, phase: "decide" }, 1)).toBeNull();
    expect(displayRound({ round: 1, phase: "reply" }, 0)).toBeNull();
  });
});

describe("pickStatusSession", () => {
  it("follows the newest running session, else the newest paused one", () => {
    const summaries = [
      session({ id: "paused", status: "paused", updatedAt: 50 }),
      session({ id: "old", status: "running", updatedAt: 10 }),
      session({ id: "new", status: "running", updatedAt: 20 }),
      session({ id: "done", status: "done", updatedAt: 99 }),
    ];
    expect(pickStatusSession(summaries)?.id).toBe("new");
    expect(pickStatusSession(summaries.filter((entry) => entry.status !== "running"))?.id).toBe(
      "paused",
    );
    expect(pickStatusSession([summaries[3]!])).toBeUndefined();
  });

  it("prefers any busy session over an idle team chat, and still shows the idle one alone", () => {
    const idle = session({ id: "idle", pattern: "open", status: "running", updatedAt: 99 });
    const paused = session({ id: "paused", status: "paused", updatedAt: 1 });
    const busy = session({ id: "busy", status: "running", updatedAt: 2 });
    expect(pickStatusSession([idle, paused, busy])?.id).toBe("busy");
    expect(pickStatusSession([idle, paused])?.id).toBe("paused");
    expect(pickStatusSession([idle])?.id).toBe("idle");
  });
});

describe("RoundtableStatusItem", () => {
  it("renders nothing without a running session", () => {
    api.sessions.set("rt1", session({ status: "done" }));
    const { container } = render(<RoundtableStatusItem />);
    expect(container.innerHTML).toBe("");
  });

  it("opens the running session on press", () => {
    api.sessions.set(
      "rt1",
      session({ turns: [turn("t1", { participantId: "a", round: 0, status: "running" })] }),
    );
    render(<RoundtableStatusItem />);
    const item = screen.getByRole("button", { name: /Open Roundtable Fix the login bug/ });
    expect(item.getAttribute("data-tone")).toBe("working");
    expect(item.textContent).toBe("Roundtable · round 1/4 · Agent A building");
    fireEvent.click(item);
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: true });
  });
});
