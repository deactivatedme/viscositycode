import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { RoundtableSession } from "../types";
import { participant, session, turn } from "./roundtable.testFixtures";
import { participantFxState } from "./RoundtableHeader";
import { RoundtableView } from "./RoundtableView";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({
  sessions: new Map<string, RoundtableSession>(),
  stopRoundtable: vi.fn<(id: string) => Promise<void>>(),
  pauseRoundtable: vi.fn<(id: string) => void>(),
  resumeRoundtable: vi.fn<(id: string) => void>(),
  postToRoundtable:
    vi.fn<(id: string, text: string, options?: { mentions?: string[] }) => Promise<void>>(),
}));
const tabs = vi.hoisted(() => ({ activateThreadTab: vi.fn<(threadId: string) => void>() }));

vi.mock("../api", () => ({
  useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
  useLiveTurnText: () => "",
  stopRoundtable: api.stopRoundtable,
  pauseRoundtable: api.pauseRoundtable,
  resumeRoundtable: api.resumeRoundtable,
  postToRoundtable: api.postToRoundtable,
}));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => tabs);

let releaseShell: (() => void) | undefined;

function renderSession(value: RoundtableSession) {
  api.sessions.set(value.id, value);
  return render(<RoundtableView sessionId={value.id} />);
}

beforeEach(() => {
  api.sessions.clear();
  api.stopRoundtable.mockReset().mockResolvedValue(undefined);
  api.pauseRoundtable.mockReset();
  api.resumeRoundtable.mockReset();
  api.postToRoundtable.mockReset().mockResolvedValue(undefined);
  tabs.activateThreadTab.mockReset();
  useAppStore.setState({ threads: [], projects: [] });
  useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true, setup: null });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
});

describe("RoundtableView header", () => {
  it("shows the title, pattern, status and one chip per participant", () => {
    renderSession(
      session({
        participants: [
          participant("a", { role: "builder" }),
          participant("b", {
            role: "reviewer",
            brain: {
              kind: "xai",
              model: "grok-4.7",
              region: "global",
              tools: { webSearch: false, xSearch: false },
            },
          }),
        ],
        turns: [turn("t1", { participantId: "b", status: "waiting-approval" })],
      }),
    );
    expect(screen.getByRole("heading", { name: "Fix the login bug" })).toBeTruthy();
    expect(screen.getByText("Build ↔ review")).toBeTruthy();
    const chips = within(screen.getByRole("list", { name: "Participants" })).getAllByRole(
      "listitem",
    );
    expect(chips.map((chip) => chip.getAttribute("data-vc-fx-state"))).toEqual([
      "idle",
      "attention",
    ]);
    expect(within(chips[0]!).getByText("Builder · model-a")).toBeTruthy();
    expect(within(chips[1]!).getByText("Reviewer · grok-4.7")).toBeTruthy();
  });

  it("derives a participant's live state from its turn, then its thread", () => {
    expect(participantFxState("running", undefined)).toBe("working");
    expect(participantFxState("waiting-approval", "working")).toBe("attention");
    expect(participantFxState("done", "needs_reply")).toBe("attention");
    expect(participantFxState("failed", "idle")).toBe("error");
    expect(participantFxState(undefined, "error")).toBe("error");
    expect(participantFxState("done", "working")).toBe("working");
    expect(participantFxState("done", "idle")).toBe("idle");
  });

  it("reads the participant thread's status from the app store", () => {
    useAppStore.setState({
      threads: [{ id: "thread-a", projectId: "p1", status: "needs_approval" } as Thread],
    });
    renderSession(session({ threadIds: { a: "thread-a" } }));
    const chip = document.querySelector('[data-vc-rt-participant="a"]');
    expect(chip?.getAttribute("data-vc-fx-state")).toBe("attention");
  });

  it("closes the view from its header", () => {
    renderSession(session());
    fireEvent.click(screen.getByRole("button", { name: "Close Roundtable" }));
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: null, shown: false });
  });

  it("explains a session that no longer exists", () => {
    render(<RoundtableView sessionId="missing" />);
    expect(screen.getByText(/This Roundtable is not available/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to threads" }));
    expect(useRoundtableViewStore.getState().openSessionId).toBeNull();
  });
});

describe("RoundtableView controls", () => {
  it("stops and pauses a running session", async () => {
    renderSession(session({ status: "running" }));
    const toolbar = screen.getByRole("toolbar", { name: "Roundtable controls" });
    await act(async () => {
      fireEvent.click(within(toolbar).getByRole("button", { name: "Stop" }));
    });
    expect(api.stopRoundtable).toHaveBeenCalledWith("rt1");
    fireEvent.click(within(toolbar).getByRole("button", { name: "Pause" }));
    expect(api.pauseRoundtable).toHaveBeenCalledWith("rt1");
    expect(api.resumeRoundtable).not.toHaveBeenCalled();
  });

  it("resumes a paused session", () => {
    renderSession(session({ status: "paused" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(api.resumeRoundtable).toHaveBeenCalledWith("rt1");
    expect(api.pauseRoundtable).not.toHaveBeenCalled();
  });

  it("disables Stop and Pause once the session has finished", () => {
    renderSession(session({ status: "done" }));
    const toolbar = screen.getByRole("toolbar", { name: "Roundtable controls" });
    expect(within(toolbar).getByRole("button", { name: "Stop" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(within(toolbar).getByRole("button", { name: "Pause" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("opens a participant's thread", () => {
    renderSession(session({ threadIds: { b: "thread-b" } }));
    const toolbar = screen.getByRole("toolbar", { name: "Roundtable controls" });
    expect(within(toolbar).queryByRole("button", { name: "Open Agent A thread" })).toBeNull();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Open Agent B thread" }));
    expect(tabs.activateThreadTab).toHaveBeenCalledWith("thread-b");
  });
});

describe("RoundtableView composer", () => {
  it("posts a message with the mentioned participants", async () => {
    renderSession(session({ pattern: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "Mention Agent B" }));
    const input = screen.getByRole("textbox", { name: "Message the Roundtable" });
    expect((input as HTMLTextAreaElement).value).toBe("@agent-b ");
    expect(
      screen.getByRole("button", { name: "Mention Agent B" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(input, { target: { value: "@agent-b what do you think?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt1", "@agent-b what do you think?", {
      mentions: ["b"],
    });
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("sends without mentions, keeps Shift+Enter for new lines and ignores empty drafts", async () => {
    renderSession(session());
    const input = screen.getByRole("textbox", { name: "Message the Roundtable" });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "Focus on the tests" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(api.postToRoundtable).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt1", "Focus on the tests", undefined);
  });

  it("keeps the draft when posting fails", async () => {
    api.postToRoundtable.mockRejectedValueOnce(new Error("Engine offline"));
    renderSession(session());
    const input = screen.getByRole("textbox", { name: "Message the Roundtable" });
    fireEvent.change(input, { target: { value: "Retry later" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect((input as HTMLTextAreaElement).value).toBe("Retry later");
  });
});
