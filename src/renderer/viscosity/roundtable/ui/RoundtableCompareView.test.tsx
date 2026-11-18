import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { AGENT_KIND_ATTRIBUTE } from "@/renderer/viscosity/agentColors/api";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { RoundtableSession } from "../types";
import { participant, session, turn } from "./roundtable.testFixtures";
import { RoundtableCompareView } from "./RoundtableCompareView";
import { RoundtableView } from "./RoundtableView";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({
  sessions: new Map<string, RoundtableSession>(),
  latestDebateId: undefined as string | undefined,
  debateRunning: false,
  startDebateFromComparison: vi.fn<(id: string) => Promise<string>>(),
}));
const actions = vi.hoisted(() => ({ continueWithThread: vi.fn<(threadId: string) => void>() }));
const toasts = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  danger: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
}));

vi.mock("../api", async () => {
  const compare = await vi.importActual<typeof import("../engine/compare")>("../engine/compare");
  return {
    canSeedDebate: compare.canSeedDebate,
    compareAnswers: compare.compareAnswers,
    useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
    useLiveTurnText: () => "",
    useLatestSeededDebateId: () => api.latestDebateId,
    useHasActiveSeededDebate: () => api.debateRunning,
    startDebateFromComparison: api.startDebateFromComparison,
    stopRoundtable: vi.fn<(id: string) => Promise<void>>(),
    pauseRoundtable: vi.fn<(id: string) => void>(),
    resumeRoundtable: vi.fn<(id: string) => void>(),
    postToRoundtable: vi.fn<(id: string, text: string) => Promise<void>>(),
  };
});
vi.mock("./compareActions", () => actions);
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => ({
  activateThreadTab: vi.fn<(threadId: string) => void>(),
}));
vi.mock("@heroui/react", async () => {
  const actual = await vi.importActual<typeof import("@heroui/react")>("@heroui/react");
  return { ...actual, toast: toasts };
});

let releaseShell: (() => void) | undefined;

function comparison(overrides: Partial<RoundtableSession> = {}): RoundtableSession {
  return session({
    id: "cmp",
    title: "Signup validation",
    task: "How should the signup form validate?",
    pattern: "compare",
    maxRounds: 1,
    status: "done",
    participants: [participant("a"), participant("b"), participant("c")],
    threadIds: { a: "thread-a", c: "thread-c" },
    turns: [
      turn("ta", {
        participantId: "a",
        round: 0,
        phase: "answer",
        responseText: "**Use a schema** shared with the server.",
        startedAt: 1_000,
        endedAt: 39_000,
      }),
      turn("tb", {
        participantId: "b",
        round: 0,
        phase: "answer",
        status: "failed",
        error: "Out of usage",
        startedAt: 1_000,
        endedAt: 3_000,
      }),
      turn("tc", {
        participantId: "c",
        round: 0,
        phase: "answer",
        responseText: "Keep native constraint validation.",
        startedAt: 1_000,
        endedAt: 126_000,
      }),
    ],
    ...overrides,
  });
}

function columns(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Answers" })).getAllByRole("listitem");
}

beforeEach(() => {
  api.sessions.clear();
  api.latestDebateId = undefined;
  api.debateRunning = false;
  api.startDebateFromComparison.mockReset().mockResolvedValue("debate-1");
  actions.continueWithThread.mockReset();
  toasts.success.mockReset();
  toasts.danger.mockReset();
  useAppStore.setState({ threads: [], projects: [] });
  useRoundtableViewStore.setState({ openSessionId: "cmp", shown: true, setup: null });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
});

describe("RoundtableCompareView", () => {
  it("shows one column per participant with its accent, status, time and answer", () => {
    render(<RoundtableCompareView session={comparison()} />);
    const [first, second, third] = columns();
    expect(columns()).toHaveLength(3);
    expect(first!.getAttribute(AGENT_KIND_ATTRIBUTE)).toBe("kind-a");
    expect(within(first!).getByRole("heading", { name: "Agent A" })).toBeTruthy();
    expect(within(first!).getByText("model-a")).toBeTruthy();
    expect(within(first!).getByText("Took 38s")).toBeTruthy();
    // Rendered by the chat's own markdown component.
    expect(
      within(first!)
        .getByText(/Use a schema/)
        .closest(".vc-rt-turn__markdown"),
    ).toBeTruthy();
    expect(within(first!).getByRole("region", { name: "Answer from Agent A" })).toBeTruthy();

    expect(second!.getAttribute("data-status")).toBe("failed");
    expect(within(second!).getByRole("alert").textContent).toBe("Out of usage");
    expect(within(third!).getByText("Took 2m 05s")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("2 of 3 answered");
    expect(screen.getByText("How should the signup form validate?")).toBeTruthy();
  });

  it("continues with one answer in its own thread", () => {
    render(<RoundtableCompareView session={comparison()} />);
    const [first, second] = columns();
    // No thread, nothing to continue with.
    expect(within(second!).queryByRole("button", { name: /Continue with/ })).toBeNull();
    // The visible label is the accessible name; the column's model describes it.
    const button = within(first!).getByRole("button", {
      name: "Continue with this one",
      description: "Agent A",
    });
    fireEvent.click(button);
    expect(actions.continueWithThread).toHaveBeenCalledWith("thread-a");
  });

  it("starts a debate from the answers and shows it", async () => {
    render(<RoundtableCompareView session={comparison()} />);
    const start = screen.getByRole("button", { name: "Start a debate from here" });
    await act(async () => {
      fireEvent.click(start);
      await Promise.resolve();
    });
    expect(api.startDebateFromComparison).toHaveBeenCalledWith("cmp");
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "debate-1",
      shown: true,
    });
    expect(toasts.success).toHaveBeenCalledWith("Debate started");
  });

  it("only adds the debate's tab when the user moved on while it started", async () => {
    let finish: (id: string) => void = () => {};
    api.startDebateFromComparison.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    render(<RoundtableCompareView session={comparison()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start a debate from here" }));
      await Promise.resolve();
    });
    // The user went back to the threads before the debate was created.
    useRoundtableViewStore.setState({ shown: false });
    await act(async () => {
      finish("debate-1");
      await Promise.resolve();
    });
    // Its tab waits in the background; nothing on screen switches.
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "debate-1",
      shown: false,
    });
    expect(toasts.success).toHaveBeenCalledWith("Debate started");
  });

  it("reports a debate that cannot start", async () => {
    api.startDebateFromComparison.mockRejectedValue(new Error("Nope"));
    render(<RoundtableCompareView session={comparison()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start a debate from here" }));
      await Promise.resolve();
    });
    expect(toasts.danger).toHaveBeenCalledWith("Nope");
    expect(useRoundtableViewStore.getState().openSessionId).toBe("cmp");
  });

  it("waits for every answer before offering a debate", () => {
    render(
      <RoundtableCompareView
        session={comparison({
          status: "running",
          turns: [turn("ta", { participantId: "a", round: 0, phase: "answer", status: "running" })],
        })}
      />,
    );
    const start = screen.getByRole("button", { name: "Start a debate from here" });
    expect(start.hasAttribute("disabled") || start.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    expect(start.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Available once every model has answered.")).toBeTruthy();
    const [first, second] = columns();
    expect(within(first!).getByText("Working")).toBeTruthy();
    expect(within(second!).getByText("Waiting to start…")).toBeTruthy();
  });

  it("opens the debate already started from here instead of a second one", () => {
    api.latestDebateId = "debate-0";
    api.debateRunning = true;
    render(<RoundtableCompareView session={comparison()} />);
    const start = screen.getByRole("button", { name: "Start a debate from here" });
    expect(start.hasAttribute("disabled") || start.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open debate" }));
    expect(useRoundtableViewStore.getState().openSessionId).toBe("debate-0");
  });
});

describe("RoundtableView with a comparison", () => {
  it("shows the answers side by side and no composer", () => {
    api.sessions.set("cmp", comparison());
    render(<RoundtableView sessionId="cmp" />);
    expect(columns()).toHaveLength(3);
    expect(screen.getByText("Ask all (compare)")).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Roundtable controls" })).toBeTruthy();
  });
});
