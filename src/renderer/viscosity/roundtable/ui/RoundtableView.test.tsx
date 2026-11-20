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
  interruptRoundtable: vi.fn<(id: string) => Promise<void>>(),
  updateRoundtableInstructions:
    vi.fn<
      (
        id: string,
        update: { shared?: string; participants?: Record<string, string> },
      ) => Promise<void>
    >(),
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  danger: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
}));
const tabs = vi.hoisted(() => ({ activateThreadTab: vi.fn<(threadId: string) => void>() }));

vi.mock("../api", () => ({
  useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
  useLiveTurnText: () => "",
  stopRoundtable: api.stopRoundtable,
  pauseRoundtable: api.pauseRoundtable,
  resumeRoundtable: api.resumeRoundtable,
  postToRoundtable: api.postToRoundtable,
  interruptRoundtable: api.interruptRoundtable,
  updateRoundtableInstructions: api.updateRoundtableInstructions,
}));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => tabs);
vi.mock("@heroui/react", async () => {
  const actual = await vi.importActual<typeof import("@heroui/react")>("@heroui/react");
  return { ...actual, toast: toasts };
});

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
  api.interruptRoundtable.mockReset().mockResolvedValue(undefined);
  api.updateRoundtableInstructions.mockReset().mockResolvedValue(undefined);
  toasts.success.mockReset();
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

  it("names each seat's playbook: its thread's binding, else the seat's or the table's", () => {
    useAppStore.setState({
      threads: [
        {
          id: "thread-a",
          projectId: "p1",
          status: "idle",
          config: {
            model: "model-a",
            playbook: { version: 1, id: "debug", label: "Debug", instructions: "Repro." },
          },
        } as Thread,
        { id: "thread-c", projectId: "p1", status: "idle", config: { model: "m" } } as Thread,
      ],
    });
    renderSession(
      session({
        playbookId: "review",
        participants: [
          participant("a", { role: "builder" }),
          participant("b", { role: "reviewer" }),
          participant("c", { role: "reviewer", playbookId: null }),
          participant("d", { role: "reviewer", playbookId: "reversing" }),
        ],
        threadIds: { a: "thread-a", c: "thread-c" },
      }),
    );
    const meta = (id: string) =>
      document.querySelector(`[data-vc-rt-participant="${id}"] .vc-rt-participant__meta`)
        ?.textContent;
    expect(meta("a")).toBe("Builder · model-a · Debug");
    expect(meta("b")).toBe("Reviewer · model-b · Review");
    expect(meta("c")).toBe("Reviewer · model-c");
    expect(meta("d")).toBe("Reviewer · model-d · Reversing");
  });

  it("shows a team chat's chips without roles, and Ready while it waits", () => {
    renderSession(
      session({
        pattern: "open",
        maxRounds: 0,
        notes: [{ id: "n1", text: "Hi", createdAt: 1 }],
        turns: [turn("t1", { round: 0, phase: "reply", noteId: "n1", participantId: "a" })],
      }),
    );
    const chip = document.querySelector<HTMLElement>('[data-vc-rt-participant="a"]')!;
    expect(within(chip).getByText("model-a")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("edits the instructions and saves only what changed", async () => {
    renderSession(
      session({
        instructions: "Be brief.",
        participants: [participant("a", { instructions: "Backend" }), participant("b")],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    const dialog = await screen.findByRole("dialog");
    const shared = within(dialog).getByRole("textbox", { name: "For everyone" });
    expect((shared as HTMLTextAreaElement).value).toBe("Be brief.");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Agent B/ }), {
      target: { value: "Write the tests" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(api.updateRoundtableInstructions).toHaveBeenCalledWith("rt1", {
      participants: { b: "Write the tests" },
    });
    expect(toasts.success).toHaveBeenCalledWith(
      "Instructions updated. They apply from the next reply.",
    );
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

  it("offers Retry on a failed session instead of Pause", () => {
    renderSession(session({ status: "failed", error: "A participant's turn failed." }));
    const toolbar = screen.getByRole("toolbar", { name: "Roundtable controls" });
    expect(within(toolbar).queryByRole("button", { name: "Pause" })).toBeNull();
    expect(within(toolbar).getByRole("button", { name: "Stop" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(within(toolbar).getByRole("button", { name: "Retry" }));
    expect(api.resumeRoundtable).toHaveBeenCalledWith("rt1");
    expect(api.pauseRoundtable).not.toHaveBeenCalled();
  });

  it("offers no Retry while a session can still run", () => {
    for (const status of ["running", "paused", "done", "stopped"] as const) {
      const { unmount } = renderSession(session({ status }));
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      unmount();
    }
  });

  it("stops only the replies of a team chat, and has no Pause", async () => {
    renderSession(
      session({
        pattern: "open",
        maxRounds: 0,
        notes: [{ id: "n1", text: "Hi", createdAt: 1 }],
        turns: [turn("t1", { round: 0, phase: "reply", noteId: "n1", status: "running" })],
      }),
    );
    const toolbar = screen.getByRole("toolbar", { name: "Roundtable controls" });
    expect(within(toolbar).queryByRole("button", { name: "Pause" })).toBeNull();
    await act(async () => {
      fireEvent.click(within(toolbar).getByRole("button", { name: "Stop replies" }));
    });
    expect(api.interruptRoundtable).toHaveBeenCalledWith("rt1");
    expect(api.stopRoundtable).not.toHaveBeenCalled();
  });

  it("has nothing to stop while a team chat waits for a message", () => {
    renderSession(session({ pattern: "open", maxRounds: 0 }));
    const stop = screen.getByRole("button", { name: "Stop replies" });
    expect(stop.hasAttribute("disabled")).toBe(true);
  });

  it("opens a participant's thread", () => {
    // Only a live (loaded, not archived) thread is offered.
    useAppStore.setState({ threads: [{ id: "thread-b", projectId: "p1" } as Thread] });
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

  it.each([
    ["done", "open", "This Roundtable is finished. Start a new one to continue."],
    ["stopped", "build-review", "This Roundtable was stopped. Start a new one to continue."],
    ["failed", "open", "This Roundtable failed. Retry it to continue."],
  ] as const)(
    "disables the composer of a %s session with a hint",
    async (status, pattern, hint) => {
      renderSession(session({ status, pattern }));
      const input = screen.getByRole("textbox", { name: "Message the Roundtable" });
      expect(input.hasAttribute("disabled")).toBe(true);
      const hintLine = screen.getByText(hint);
      expect(hintLine.getAttribute("role")).toBe("status");
      expect(input.getAttribute("aria-describedby")).toBe(hintLine.id);
      expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
      const mention = screen.queryByRole("button", { name: "Mention Agent B" });
      // Only a team chat shows mention chips (disabled once ended).
      expect(mention?.hasAttribute("disabled") ?? null).toBe(pattern === "open" ? true : null);
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      expect(api.postToRoundtable).not.toHaveBeenCalled();
    },
  );

  it("keeps a stopped team chat's composer open, since posting reopens it", () => {
    renderSession(session({ status: "stopped", pattern: "open" }));
    const input = screen.getByRole("textbox", { name: "Message the Roundtable" });
    expect(input.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Start a new one to continue/)).toBeNull();
  });

  it("offers to continue a finished session as a team chat", () => {
    renderSession(
      session({
        status: "done",
        turns: [turn("t1", { participantId: "a", round: 0, responseText: "Shipped it" })],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue as a team chat" }));
    const request = useRoundtableViewStore.getState().setup?.request;
    expect(request).toMatchObject({ projectId: "p1", pattern: "open", title: "Fix the login bug" });
    expect(request?.participants?.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(request?.task).toContain("Shipped it");
  });

  it("keeps the composer open with no hint while the session runs or is paused", () => {
    for (const status of ["running", "paused"] as const) {
      const { unmount } = renderSession(session({ status }));
      const input = screen.getByRole("textbox", { name: "Message the Roundtable" });
      expect(input.hasAttribute("disabled")).toBe(false);
      expect(input.hasAttribute("aria-describedby")).toBe(false);
      expect(screen.queryByText(/Start a new one to continue|Retry it to continue/)).toBeNull();
      unmount();
    }
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
