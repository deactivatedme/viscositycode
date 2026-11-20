import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ReadyAgentBrain } from "../api";
import { useRoundtableInviteStore } from "./inviteStore";
import { inviteSeatLimits, RoundtableInviteDialog } from "./RoundtableInviteDialog";

const mocks = vi.hoisted(() => ({
  startRoundtable: vi.fn<(input: unknown) => Promise<string>>(),
  brains: [] as ReadyAgentBrain[],
}));
vi.mock("@/renderer/viscosity/roundtable/api", () => ({
  startRoundtable: mocks.startRoundtable,
  postToRoundtable: vi.fn<() => Promise<void>>(),
  useReadyAgentBrains: () => mocks.brains,
}));
vi.mock("@/renderer/state/useThread", () => ({
  useThread: (threadId: string | undefined) =>
    threadId === "chat-1"
      ? {
          id: "chat-1",
          title: "Fix login",
          agentKind: "beta",
          config: { model: "b1" },
          presentationMode: "terminal",
        }
      : undefined,
}));
vi.mock("@/renderer/bridge", () => ({ isRemoteSession: () => false }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startRoundtable.mockResolvedValue("rt-1");
  mocks.brains = [
    {
      agentKind: "alpha",
      label: "Alpha",
      models: [{ id: "a1", label: "One" }],
      defaultModel: "a1",
      presentationModes: ["gui"],
    },
  ];
});

describe("inviteSeatLimits", () => {
  it("counts the origin chat as one of the 2–5 seats", () => {
    expect(inviteSeatLimits("invite")).toEqual({ min: 1, max: 4 });
    expect(inviteSeatLimits("new")).toEqual({ min: 2, max: 5 });
  });
});

describe("RoundtableInviteDialog", () => {
  it("invites a picked model into the chat to work together, with instructions for everyone", async () => {
    const onStarted = vi.fn<() => void>();
    const request = {
      kind: "invite" as const,
      projectId: "project-1",
      originThreadId: "chat-1",
      task: "Review the login fix",
      onStarted,
    };
    useRoundtableInviteStore.setState({ request, nonce: 1 });
    render(<RoundtableInviteDialog request={request} />);
    expect(screen.getByText("From chat: Fix login")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start Roundtable" });
    expect(start).toBeDisabled();

    // The menu trigger is wrapped by its tooltip trigger; press the innermost button.
    fireEvent.click(screen.getAllByRole("button", { name: "Add participant" }).at(-1)!);
    fireEvent.click(await screen.findByRole("option", { name: /Alpha · One/ }));
    await waitFor(() => expect(start).not.toBeDisabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Instructions for everyone" }), {
      target: { value: "  Keep the public API.  " },
    });
    fireEvent.click(start);

    await waitFor(() => expect(mocks.startRoundtable).toHaveBeenCalled());
    expect(mocks.startRoundtable).toHaveBeenCalledWith({
      task: "Review the login fix",
      pattern: "open",
      projectId: "project-1",
      originThreadId: "chat-1",
      worktree: { mode: "current" },
      instructions: "Keep the public API.",
      participants: [
        // The engine binds the origin chat to seat 0.
        {
          id: "origin:chat-1",
          label: "Fix login",
          role: "member",
          brain: { kind: "agent", agentKind: "beta", model: "b1", presentationMode: "terminal" },
        },
        {
          id: "model:alpha:a1",
          label: "Alpha · One",
          role: "member",
          brain: { kind: "agent", agentKind: "alpha", model: "a1", presentationMode: "gui" },
        },
      ],
    });
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(useRoundtableInviteStore.getState().request).toBeNull();
  });

  it("lets a team chat start without a first message", async () => {
    const request = {
      kind: "invite" as const,
      projectId: "project-1",
      originThreadId: "chat-1",
      task: "",
    };
    render(<RoundtableInviteDialog request={request} />);
    expect(screen.getByRole("textbox", { name: "First message (optional)" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add participant" }).at(-1)!);
    fireEvent.click(await screen.findByRole("option", { name: /Alpha · One/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start Roundtable" })).not.toBeDisabled(),
    );
  });

  it("explains when no model is ready", () => {
    mocks.brains = [];
    const request = { kind: "new" as const, projectId: "project-1", task: "" };
    render(<RoundtableInviteDialog request={request} />);
    expect(screen.getByText(/No signed-in models are ready/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Roundtable" })).toBeDisabled();
  });
});
