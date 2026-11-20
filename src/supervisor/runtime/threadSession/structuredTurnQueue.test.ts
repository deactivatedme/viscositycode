// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { describe, expect, it, vi } from "vitest";
import { messageItemPayloadSchema } from "@/shared/contracts";
import { playbookFingerprint } from "@/shared/viscosity/playbook";
import { StructuredTurnQueue, type StructuredTurnQueueContext } from "./structuredTurnQueue";
import { createFollowUpQueueHarness } from "../threadSessionManager.followUpQueueTestHarness";

describe("StructuredTurnQueue answer metadata", () => {
  it.each(["idle", "working"] as const)(
    "forwards source identity through a %s session",
    async (status) => {
      const h = createFollowUpQueueHarness();
      h.session.status = status;
      const questionAnswer = {
        sourceItemId: "question-message",
        questions: [{ header: "", question: "Scope?", selected: [{ label: "Small" }] }],
      };
      try {
        await h.manager.sendThreadInput({
          threadId: h.session.threadId,
          prompt: "Scope?\nSmall",
          config: h.session.config,
          questionAnswer,
        });
        const send = status === "working" ? h.steerTurn : h.startTurn;
        expect(send).toHaveBeenCalledExactlyOnceWith(
          "Scope?\nSmall",
          h.session.config,
          undefined,
          expect.objectContaining({ questionAnswer }),
        );
      } finally {
        h.finish();
        await h.manager.dispose();
      }
    },
  );

  it("keeps answers on the durable user message while preserving ordinary prompt content and identity", () => {
    const emit = vi.fn<StructuredTurnQueueContext["emit"]>();
    const queue = new StructuredTurnQueue({
      emit,
      emitTurnContinuation: vi.fn<StructuredTurnQueueContext["emitTurnContinuation"]>(),
      sessions: new Map(),
      outputPipeline: {
        updateState: vi.fn<StructuredTurnQueueContext["outputPipeline"]["updateState"]>(),
      },
      beginFailureEpisode: vi.fn<StructuredTurnQueueContext["beginFailureEpisode"]>(),
      failStructuredSession: vi.fn<StructuredTurnQueueContext["failStructuredSession"]>(),
    });
    const questionAnswer = {
      questions: [{ header: "", question: "Which scope?", selected: [{ label: "Focused" }] }],
    };
    const id = queue.emitOptimisticUserMessage(
      "thread",
      "Which scope?\nFocused",
      undefined,
      "answer",
      { questionAnswer },
    );
    expect(id).toBe("answer");
    const event = emit.mock.calls
      .map(([entry]) => entry)
      .find(
        (entry) => entry.type === "thread-runtime-event" && entry.event.type === "item.started",
      );
    expect(event).toEqual({
      type: "thread-runtime-event",
      threadId: "thread",
      event: {
        type: "item.started",
        threadId: "thread",
        itemId: "answer",
        itemType: "user_message",
        payload: { content: [{ kind: "text", text: "Which scope?\nFocused" }], questionAnswer },
      },
    });
    if (event?.type !== "thread-runtime-event" || event.event.type !== "item.started")
      throw new Error("Missing user message");
    expect(messageItemPayloadSchema.parse(JSON.parse(JSON.stringify(event.event.payload)))).toEqual(
      event.event.payload,
    );
  });
});

// ViscosityCode: a launch-queued first turn (server-controlled terminal chats) carries the playbook.
describe("StructuredTurnQueue launch-queued prompt", () => {
  it("sends the playbook brief and records its delivery", () => {
    const queue = new StructuredTurnQueue({
      emit: vi.fn<StructuredTurnQueueContext["emit"]>(),
      emitTurnContinuation: vi.fn<StructuredTurnQueueContext["emitTurnContinuation"]>(),
      sessions: new Map(),
      outputPipeline: {
        updateState: vi.fn<StructuredTurnQueueContext["outputPipeline"]["updateState"]>(),
      },
      beginFailureEpisode: vi.fn<StructuredTurnQueueContext["beginFailureEpisode"]>(),
      failStructuredSession: vi.fn<StructuredTurnQueueContext["failStructuredSession"]>(),
    });
    const startTurn = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
    const playbook = {
      version: 1 as const,
      id: "reversing",
      label: "Reversing",
      instructions: "Triage first.",
    };
    const session = {
      threadId: "t1",
      instanceId: "i1",
      config: { model: "m", playbook },
      pendingLaunchPrompt: "find main",
      structuredSession: { startTurn, placesTurnContext: true },
    } as unknown as Parameters<StructuredTurnQueue["startQueuedLaunchPrompt"]>[0];

    queue.startQueuedLaunchPrompt(session);

    expect(startTurn).toHaveBeenCalledOnce();
    const [prompt, config, segments, options] = startTurn.mock.calls[0] as [
      string,
      unknown,
      unknown,
      { turnContext?: string; onPromptSubmitted?: () => void },
    ];
    expect([prompt, config, segments]).toEqual(["find main", session.config, undefined]);
    expect(options.turnContext).toContain('[playbook] This chat uses the "Reversing" playbook.');
    options.onPromptSubmitted?.();
    expect(session.playbookBriefDelivered).toBe(playbookFingerprint(playbook));
  });
});
