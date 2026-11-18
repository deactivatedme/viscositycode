import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { RoundtableSession } from "../types";
import { session, summaryOf, turn } from "./roundtable.testFixtures";
import {
  describeRoundtableProgress,
  pickStatusSession,
  RoundtableStatusItem,
} from "./RoundtableStatusItem";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({ sessions: new Map<string, RoundtableSession>() }));

vi.mock("../api", () => ({
  useRoundtableList: () => [...api.sessions.values()].map(summaryOf),
  useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
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
        turn("t1", { participantId: "a", round: 1 }),
        turn("t2", { participantId: "b", round: 2, status: "running" }),
      ],
    });
    expect(describeRoundtableProgress(value, i18n)).toEqual({
      label: "Roundtable · round 2/4 · Agent B reviewing",
      tone: "working",
    });
  });

  it("asks for attention while a participant waits for approval or the table is paused", () => {
    const waiting = session({
      turns: [turn("t1", { participantId: "a", status: "waiting-approval" })],
    });
    expect(describeRoundtableProgress(waiting, i18n)).toEqual({
      label: "Roundtable · round 1/4 · Agent A needs your approval",
      tone: "attention",
    });
    expect(
      describeRoundtableProgress(session({ status: "paused", turns: [turn("t1")] }), i18n),
    ).toEqual({ label: "Roundtable · round 1/4 · paused", tone: "attention" });
  });

  it("drops the limit for unlimited chats and says when it is starting", () => {
    expect(describeRoundtableProgress(session({ maxRounds: 0 }), i18n).label).toBe(
      "Roundtable · starting",
    );
    const open = session({
      pattern: "open",
      maxRounds: Number.POSITIVE_INFINITY,
      turns: [turn("t1", { round: 3, participantId: "a", status: "running" })],
    });
    expect(describeRoundtableProgress(open, i18n).label).toBe(
      "Roundtable · round 3 · Agent A building",
    );
  });
});

describe("pickStatusSession", () => {
  it("follows the newest running session, else the newest paused one", () => {
    const summaries = [
      summaryOf(session({ id: "paused", status: "paused", updatedAt: 50 })),
      summaryOf(session({ id: "old", status: "running", updatedAt: 10 })),
      summaryOf(session({ id: "new", status: "running", updatedAt: 20 })),
      summaryOf(session({ id: "done", status: "done", updatedAt: 99 })),
    ];
    expect(pickStatusSession(summaries)?.id).toBe("new");
    expect(pickStatusSession(summaries.filter((entry) => entry.status !== "running"))?.id).toBe(
      "paused",
    );
    expect(pickStatusSession([summaries[3]!])).toBeUndefined();
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
      session({ turns: [turn("t1", { participantId: "a", status: "running" })] }),
    );
    render(<RoundtableStatusItem />);
    const item = screen.getByRole("button", { name: /Open Roundtable Fix the login bug/ });
    expect(item.getAttribute("data-tone")).toBe("working");
    expect(item.textContent).toBe("Roundtable · round 1/4 · Agent A building");
    fireEvent.click(item);
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: true });
  });
});
