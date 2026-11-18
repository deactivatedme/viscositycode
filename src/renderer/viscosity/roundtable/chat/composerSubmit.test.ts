import "@/renderer/testUtils/clientDraftDatabase";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import {
  submitComposerPrompt,
  type ComposerSubmitContext,
} from "@/renderer/components/thread/threadComposerSubmit";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import type { ReadyAgentBrain } from "../api";
import { useRoundtableChatLinksStore } from "./chatLinksStore";
import { closeRoundtableInvite, useRoundtableInviteStore } from "./inviteStore";
import { buildRoundtableMentionTargets } from "./mentions";

const mocks = vi.hoisted(() => ({
  submit: vi.fn<() => Promise<void>>(),
  steer: vi.fn<() => void>(),
  queue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  deny: vi.fn<() => Promise<void>>(),
  clearDraft: vi.fn<() => void>(),
  saveDraft: vi.fn<(...args: unknown[]) => void>(),
  startRoundtable: vi.fn<(input: unknown) => Promise<string>>(),
  postToRoundtable: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("@/renderer/components/thread/SideChat/sideChatActions", () => ({
  sideChatAvailable: () => false,
  openSideChat: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/renderer/actions/threadRuntimeActions", () => ({
  submitThreadInput: mocks.submit,
  setThreadPendingSteer: mocks.steer,
  resolveThreadServerRequest: mocks.deny,
  changeThreadConfig: vi.fn<() => void>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: () => ({ queueThreadFollowUp: mocks.queue }) }));
vi.mock("@/renderer/viscosity/roundtable/api", () => ({
  startRoundtable: mocks.startRoundtable,
  postToRoundtable: mocks.postToRoundtable,
}));
vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({
      threadDraftContents: {},
      clearThreadDraftContent: mocks.clearDraft,
      saveThreadDraftContent: mocks.saveDraft,
      requestChatScrollToPrompt: vi.fn<() => void>(),
      applyRuntimeEvent: vi.fn<() => void>(),
      updateThreadRuntime: vi.fn<() => void>(),
      removeThreadRuntimeItem: vi.fn<() => void>(),
      runtimeItemIdsByThread: { parent: ["u1"] },
      runtimeItemsByIdByThread: {
        parent: {
          u1: {
            id: "u1",
            type: "user_message",
            state: "completed",
            streams: {},
            payload: { content: [{ kind: "text", text: "Make the build faster" }] },
          },
        },
      },
    }),
  },
}));

const brains: ReadyAgentBrain[] = [
  {
    agentKind: "alpha",
    label: "Alpha",
    models: [{ id: "a1", label: "One" }],
    defaultModel: "a1",
    presentationModes: ["gui"],
  },
];

const thread = {
  id: "parent",
  projectId: "project-1",
  agentKind: "neutral-gui",
  config: { model: "default" },
  presentationMode: "gui",
  status: "idle",
} as Thread;

function context(): ComposerSubmitContext {
  return {
    thread,
    agentStatus: undefined,
    presentationMode: "gui",
    usesTerminalPresentation: false,
    canSubmit: true,
    usesPendingSteerPath: true,
    followUpBehavior: "queue",
    needsFocusBeforeInput: false,
    activeRuntimeRequest: undefined,
    approvalDenyOption: undefined,
    availableCommands: [],
    attachments: {
      attachments: [],
      getAttachments: () => [],
      getDraftAttachments: () => [],
      hasPendingUploads: () => false,
      toSegments: () => [],
      clearAll: vi.fn<() => void>(),
      restore: vi.fn<() => void>(),
    } as never,
    mentionRef: {
      current: {
        clear: vi.fn<() => void>(),
        focus: vi.fn<() => void>(),
        restoreFromSegments: vi.fn<() => void>(),
      } as never,
    },
    terminalPaneRef: { current: null },
    latestSegmentsRef: { current: [] },
    submittedRef: { current: false },
    isCurrentSession: () => true,
    setPrompt: vi.fn<() => void>(),
    setHasContent: vi.fn<() => void>(),
    setIsSubmitting: vi.fn<() => void>(),
    requestOpenControl: vi.fn<() => void>(),
    roundtableMentionTargets: buildRoundtableMentionTargets(brains, []),
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queue.mockResolvedValue(undefined);
  mocks.startRoundtable.mockResolvedValue("rt-1");
  mocks.postToRoundtable.mockResolvedValue(undefined);
  useRoundtableChatLinksStore.setState({ links: {} });
  closeRoundtableInvite();
  document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("composer submit with Roundtable hook-ins", () => {
  it("sends an ordinary message to this chat unchanged", async () => {
    const ctx = context();
    await submitComposerPrompt([{ kind: "text", content: "plain follow-up" }], ctx);
    await waitFor(() => expect(mocks.queue).toHaveBeenCalled());
    expect(mocks.queue).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "parent", prompt: "plain follow-up" }),
    );
    expect(mocks.startRoundtable).not.toHaveBeenCalled();
    expect(mocks.postToRoundtable).not.toHaveBeenCalled();
  });

  it("posts a message that @mentions a model to an open Roundtable instead", async () => {
    const ctx = context();
    ctx.latestSegmentsRef.current = [{ kind: "text", content: "@Alpha · One take a look" }];
    await submitComposerPrompt(ctx.latestSegmentsRef.current, ctx);
    await settled();
    expect(mocks.startRoundtable).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: "open",
        originThreadId: "parent",
        participants: [
          // Seat 0 is this chat's own agent and model; the engine binds it to the chat.
          expect.objectContaining({
            id: "origin:parent",
            brain: expect.objectContaining({ agentKind: "neutral-gui", model: "default" }),
          }),
          expect.objectContaining({ id: "model:alpha:a1" }),
        ],
      }),
    );
    expect(mocks.postToRoundtable).toHaveBeenCalledWith("rt-1", "@Alpha · One take a look", {
      mentions: ["model:alpha:a1"],
    });
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.steer).not.toHaveBeenCalled();
    expect(ctx.mentionRef.current!.clear).toHaveBeenCalled();
    expect(mocks.clearDraft).toHaveBeenCalledWith("parent");
  });

  it("leaves a mention-free surface (no targets) on the normal path", async () => {
    const ctx = { ...context(), roundtableMentionTargets: undefined };
    await submitComposerPrompt([{ kind: "text", content: "@Alpha · One hi" }], ctx);
    await waitFor(() => expect(mocks.queue).toHaveBeenCalled());
    expect(mocks.postToRoundtable).not.toHaveBeenCalled();
  });

  it("opens the invite dialog for /roundtable without sending anything", async () => {
    const ctx = context();
    await submitComposerPrompt([{ kind: "text", content: "/roundtable compare designs" }], ctx);
    await settled();
    expect(useRoundtableInviteStore.getState().request).toMatchObject({
      kind: "invite",
      projectId: "project-1",
      originThreadId: "parent",
      task: "compare designs",
    });
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    // The composer keeps the text until the Roundtable actually starts.
    expect(ctx.mentionRef.current!.clear).not.toHaveBeenCalled();
    useRoundtableInviteStore.getState().request?.onStarted?.();
    expect(ctx.mentionRef.current!.clear).toHaveBeenCalled();
  });

  it("defaults the /roundtable task to the chat's latest user message", async () => {
    await submitComposerPrompt([{ kind: "text", content: "/roundtable" }], context());
    expect(useRoundtableInviteStore.getState().request?.task).toBe("Make the build faster");
  });
});
