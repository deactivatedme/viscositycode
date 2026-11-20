import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { participant, session, turn } from "./roundtable.testFixtures";
import {
  buildTranscriptEntries,
  findDecisionTurn,
  RoundtableTranscript,
  showsTaskCard,
} from "./RoundtableTranscript";

const api = vi.hoisted(() => ({
  live: {} as Record<string, string>,
  useLiveTurnText: vi.fn<(sessionId: string, turnId: string) => string>(),
}));
const tabs = vi.hoisted(() => ({ activateThreadTab: vi.fn<(threadId: string) => void>() }));

vi.mock("../api", () => ({ useLiveTurnText: api.useLiveTurnText }));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => tabs);

beforeEach(() => {
  api.live = {};
  api.useLiveTurnText.mockReset();
  api.useLiveTurnText.mockImplementation((_sessionId, turnId) => api.live[turnId] ?? "");
  tabs.activateThreadTab.mockReset();
  // The participant threads are live (loaded, not archived) unless a test says otherwise.
  setThreads(["thread-a", "thread-b", "thread-c"]);
});

function setThreads(ids: string[], archived: string[] = []): void {
  useAppStore.setState({
    threads: [...ids, ...archived].map(
      (id) => ({ id, projectId: "p1", archived: archived.includes(id) }) as Thread,
    ),
  });
}

function bubble(turnId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-vc-rt-turn="${turnId}"]`);
  if (!element) throw new Error(`no bubble for ${turnId}`);
  return element;
}

describe("buildTranscriptEntries", () => {
  it("separates rounds and places the user's messages before the turns that follow them", () => {
    const turns = [
      turn("t1", { round: 1, startedAt: 10 }),
      turn("t2", { round: 1, startedAt: 20 }),
      turn("t3", { round: 2, startedAt: 30, noteId: "n2" }),
      turn("t4", { round: 2, status: "pending" }),
    ];
    const notes = [
      { id: "n2", text: "second", createdAt: 40 },
      { id: "n1", text: "first", createdAt: 15 },
      { id: "n3", text: "last", createdAt: 99 },
    ];
    expect(buildTranscriptEntries(turns, notes).map((entry) => entry.key)).toEqual([
      "round:1:t1",
      "t1",
      "note:n1",
      "t2",
      "note:n2",
      "round:2:t3",
      "t3",
      "t4",
      "note:n3",
    ]);
  });

  it("adds no round separators when asked not to", () => {
    const turns = [turn("t1", { round: 0 }), turn("t2", { round: 1 })];
    expect(buildTranscriptEntries(turns, [], false).map((entry) => entry.key)).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("hides an empty task, and a team chat's task that is just its first message", () => {
    const note = { id: "n1", text: "Plan the release", createdAt: 1 };
    expect(showsTaskCard({ pattern: "open", task: " ", notes: [] })).toBe(false);
    expect(showsTaskCard({ pattern: "open", task: "Plan the release ", notes: [note] })).toBe(
      false,
    );
    expect(showsTaskCard({ pattern: "open", task: "Topic", notes: [note] })).toBe(true);
    expect(showsTaskCard({ pattern: "debate", task: "Plan the release", notes: [note] })).toBe(
      true,
    );
  });

  it("finds the decision turn of the winner first", () => {
    const turns = [
      turn("p1", { verdict: "pick", pickedParticipantId: "b" }),
      turn("p2", { verdict: "pick", pickedParticipantId: "a" }),
      turn("p3", { verdict: "approve" }),
    ];
    expect(findDecisionTurn(turns, "b")?.id).toBe("p1");
    expect(findDecisionTurn(turns, "z")?.id).toBe("p2");
    expect(findDecisionTurn(turns, undefined)?.id).toBe("p2");
  });
});

describe("RoundtableTranscript", () => {
  it("renders the task and every turn status", () => {
    api.live.run = "Halfway through the fix";
    render(
      <RoundtableTranscript
        session={session({
          threadIds: { b: "thread-b" },
          turns: [
            turn("done", { participantId: "a", responseText: "Patched the redirect." }),
            turn("fail", { participantId: "a", status: "failed", error: "Agent crashed" }),
            turn("stop", { participantId: "a", status: "stopped", responseText: "Partial work" }),
            turn("wait", { participantId: "b", round: 2, status: "waiting-approval" }),
            turn("run", { participantId: "a", round: 2, status: "running" }),
            turn("idle", { participantId: "b", round: 2, status: "running" }),
            turn("next", { participantId: "b", round: 3, status: "pending" }),
            turn("empty", { participantId: "b", round: 3, status: "done", truncated: true }),
          ],
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Task" })).toBeTruthy();
    expect(screen.getByText("Find and fix the login redirect loop.")).toBeTruthy();
    expect(within(bubble("done")).getByText("Patched the redirect.")).toBeTruthy();
    expect(within(bubble("done")).getByText("Builder")).toBeTruthy();
    expect(within(bubble("fail")).getByRole("alert").textContent).toBe("Agent crashed");
    expect(within(bubble("stop")).getByText("Partial work")).toBeTruthy();
    expect(within(bubble("stop")).getAllByText("Stopped").length).toBeGreaterThan(0);
    expect(within(bubble("wait")).getByRole("status").textContent).toMatch(
      /Agent B is waiting for your approval/,
    );
    expect(within(bubble("run")).getByText("Halfway through the fix")).toBeTruthy();
    expect(within(bubble("idle")).getByText("Working…")).toBeTruthy();
    expect(within(bubble("next")).getAllByText("Up next").length).toBeGreaterThan(0);
    expect(within(bubble("empty")).getByText("No reply")).toBeTruthy();
    expect(bubble("wait").getAttribute("data-status")).toBe("waiting-approval");

    const separators = screen.getAllByRole("separator").map((element) => element.textContent);
    // The engine counts rounds from 0.
    expect(separators).toEqual(["Round 2 of 4", "Round 3 of 4", "Round 4 of 4"]);
    expect(api.useLiveTurnText).not.toHaveBeenCalledWith("rt1", "done");
  });

  it("labels debate steps by what they are, not by raw round numbers", () => {
    render(
      <RoundtableTranscript
        session={session({
          pattern: "debate",
          maxRounds: 2,
          turns: [
            turn("p", { round: 0, phase: "propose" }),
            turn("c1", { round: 1, phase: "critique" }),
            turn("c2", { round: 2, phase: "critique" }),
            turn("d", { round: 3, phase: "decide" }),
          ],
        })}
      />,
    );
    const separators = screen.getAllByRole("separator").map((element) => element.textContent);
    expect(separators).toEqual(["Proposals", "Round 1 of 2", "Round 2 of 2", "Decision"]);
    expect(bubble("c2").getAttribute("aria-label")).toBe("Agent A, round 2");
  });

  it("shows a team chat as one conversation: no rounds, phases or duplicated task", () => {
    render(
      <RoundtableTranscript
        session={session({
          pattern: "open",
          maxRounds: 0,
          task: "Plan the release",
          instructions: "Answer in Portuguese.",
          threadIds: { a: "thread-a" },
          notes: [{ id: "n1", text: "Plan the release", createdAt: 1, halted: true }],
          turns: [
            turn("r0", { round: 0, phase: "reply", noteId: "n1", responseText: "Step one" }),
            turn("r1", { round: 1, phase: "reply", noteId: "n1", participantId: "b" }),
          ],
        })}
      />,
    );
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Task" })).toBeNull();
    expect(screen.queryByText("Reply")).toBeNull();
    expect(bubble("r0").getAttribute("aria-label")).toBe("Agent A");
    expect(screen.getByText("Instructions for everyone")).toBeTruthy();
    expect(screen.getByText("Answer in Portuguese.")).toBeTruthy();
  });

  it("labels only the messages a stop actually cut short", () => {
    render(
      <RoundtableTranscript
        session={session({
          pattern: "open",
          maxRounds: 0,
          notes: [
            { id: "n1", text: "First", createdAt: 1, halted: true },
            { id: "n2", text: "Second", createdAt: 2, halted: true },
            { id: "n3", text: "Third", createdAt: 3, halted: true },
          ],
          turns: [
            turn("a1", { round: 0, phase: "reply", noteId: "n1", participantId: "a" }),
            turn("b1", { round: 0, phase: "reply", noteId: "n1", participantId: "b" }),
            turn("a2", { round: 0, phase: "reply", noteId: "n2", status: "stopped" }),
            turn("a3", { round: 0, phase: "reply", noteId: "n3", participantId: "a" }),
          ],
        })}
      />,
    );
    const label = "You stopped the replies to this message.";
    const note = (id: string) => document.querySelector<HTMLElement>(`[data-vc-rt-note="${id}"]`)!;
    expect(within(note("n1")).queryByText(label)).toBeNull();
    expect(within(note("n2")).getByText(label)).toBeTruthy();
    // Agent B never got to answer the third message.
    expect(within(note("n3")).getByText(label)).toBeTruthy();
  });

  it("offers Copy and Open thread on a settled answer", () => {
    render(
      <RoundtableTranscript
        session={session({
          threadIds: { a: "thread-a" },
          turns: [
            turn("done", { participantId: "a", responseText: "Patched." }),
            turn("run", { participantId: "a", status: "running" }),
          ],
        })}
      />,
    );
    expect(within(bubble("done")).getByRole("button", { name: "Copy answer" })).toBeTruthy();
    fireEvent.click(within(bubble("done")).getByRole("button", { name: "Open Agent A thread" }));
    expect(tabs.activateThreadTab).toHaveBeenCalledWith("thread-a");
    expect(within(bubble("run")).queryByRole("button", { name: "Copy answer" })).toBeNull();
  });

  it("offers no Open thread for a deleted or archived participant thread", () => {
    setThreads([], ["thread-b"]);
    render(
      <RoundtableTranscript
        session={session({
          threadIds: { a: "thread-a", b: "thread-b" },
          turns: [
            turn("done", { participantId: "a", responseText: "Patched." }),
            turn("wait", { participantId: "b", status: "waiting-approval" }),
          ],
        })}
      />,
    );
    // thread-a was deleted, thread-b archived; the answer can still be copied.
    expect(within(bubble("done")).getByRole("button", { name: "Copy answer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Agent A thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Agent B thread" })).toBeNull();
  });

  it("opens the waiting participant's thread from the approval callout", () => {
    render(
      <RoundtableTranscript
        session={session({
          threadIds: { b: "thread-b" },
          turns: [turn("wait", { participantId: "b", status: "waiting-approval" })],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Agent B thread" }));
    expect(tabs.activateThreadTab).toHaveBeenCalledWith("thread-b");
  });

  it("shows verdict badges", () => {
    render(
      <RoundtableTranscript
        session={session({
          turns: [
            turn("ok", { participantId: "b", verdict: "approve", responseText: "LGTM" }),
            turn("redo", { participantId: "b", verdict: "revise", responseText: "Fix tests" }),
            turn("pick", {
              participantId: "b",
              verdict: "pick",
              pickedParticipantId: "a",
              responseText: "A is better",
            }),
            turn("pick2", { participantId: "b", verdict: "pick", responseText: "?" }),
          ],
        })}
      />,
    );
    const verdictOf = (id: string) => bubble(id).querySelector(".vc-rt-verdict");
    expect(verdictOf("ok")?.getAttribute("data-verdict")).toBe("approve");
    expect(verdictOf("ok")?.textContent).toBe("Approved");
    expect(verdictOf("redo")?.textContent).toBe("Changes requested");
    expect(verdictOf("pick")?.textContent).toBe("Recommends Agent A");
    expect(verdictOf("pick2")?.textContent).toBe("Recommendation");
  });

  it("shows the user's messages with their recipients", () => {
    render(
      <RoundtableTranscript
        session={session({
          pattern: "open",
          notes: [
            { id: "n1", text: "What do you think?", mentions: ["b"], createdAt: 5 },
            { id: "n2", text: "Use the new API", createdAt: 6, deliveredTurnId: "t1" },
          ],
          turns: [turn("t1", { participantId: "a", startedAt: 7, responseText: "Done" })],
        })}
      />,
    );
    const first = document.querySelector<HTMLElement>('[data-vc-rt-note="n1"]')!;
    expect(within(first).getByText("You")).toBeTruthy();
    expect(within(first).getByText("What do you think?")).toBeTruthy();
    expect(within(first).getByText("to Agent B")).toBeTruthy();
    const second = document.querySelector<HTMLElement>('[data-vc-rt-note="n2"]')!;
    expect(within(second).getByText("Added to the next prompt of Agent A")).toBeTruthy();
  });

  it("shows the decision with the winner and the rationale", () => {
    render(
      <RoundtableTranscript
        session={session({
          pattern: "debate",
          status: "done",
          winnerParticipantId: "a",
          participants: [participant("a"), participant("b"), participant("j", { role: "judge" })],
          outcome: { reason: "judge" },
          turns: [
            turn("j1", {
              participantId: "j",
              verdict: "pick",
              pickedParticipantId: "a",
              responseText: "A handles the edge cases.",
            }),
          ],
        })}
      />,
    );
    const decision = screen.getByRole("region", { name: "Result" });
    expect(decision.textContent).toContain("Recommended: Agent A");
    expect(within(decision).getByText("Rationale from Agent J")).toBeTruthy();
    expect(within(decision).getByText("A handles the edge cases.")).toBeTruthy();
    expect(within(decision).getByRole("button", { name: "Copy rationale" })).toBeTruthy();
  });

  it("does not present a run that ran out of rounds as a result", () => {
    render(
      <RoundtableTranscript
        session={session({ status: "done", outcome: { reason: "max-rounds" } })}
      />,
    );
    expect(screen.getByRole("region", { name: "Not approved yet" })).toBeTruthy();
  });

  it("prefers the engine's own rationale and explains a failure", () => {
    const { rerender } = render(
      <RoundtableTranscript
        session={session({
          status: "done",
          outcome: { reason: "approved", rationale: "Reviewer approved round 2." },
        })}
      />,
    );
    const decision = screen.getByRole("region", { name: "Result" });
    expect(within(decision).getByText("A reviewer approved the work.")).toBeTruthy();
    expect(within(decision).getByText("Rationale")).toBeTruthy();
    expect(within(decision).getByText("Reviewer approved round 2.")).toBeTruthy();

    rerender(
      <RoundtableTranscript session={session({ status: "failed", error: "Builder crashed" })} />,
    );
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Builder crashed");
  });
});
