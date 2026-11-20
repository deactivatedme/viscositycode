import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadyAgentBrain } from "../api";
import {
  getRoundtableChatLink,
  resetKnownRoundtables,
  setRoundtableChatLink,
  syncKnownRoundtables,
  useRoundtableChatLinksStore,
} from "./chatLinksStore";
import { buildRoundtableMentionTargets } from "./mentions";
import { RoundtableInputError } from "../engine/session";
import { postMentionedRoundtableMessage } from "./mentionRouting";

const api = vi.hoisted(() => ({
  startRoundtable: vi.fn<(input: unknown) => Promise<string>>(),
  postToRoundtable:
    vi.fn<(id: string, text: string, options?: { mentions?: string[] }) => Promise<void>>(),
  addRoundtableParticipants: vi.fn<(id: string, participants: unknown[]) => Promise<void>>(),
}));
vi.mock("@/renderer/viscosity/roundtable/api", () => api);

const brains: ReadyAgentBrain[] = [
  {
    agentKind: "alpha",
    label: "Alpha",
    models: [{ id: "a1", label: "One" }],
    defaultModel: "a1",
    presentationModes: ["gui"],
  },
  {
    agentKind: "beta",
    label: "Beta",
    models: [{ id: "b1", label: "One" }],
    defaultModel: "b1",
    presentationModes: ["terminal"],
  },
];
const targets = buildRoundtableMentionTargets(brains);
const [alpha, beta] = targets;

/** The chat the mentions are typed in: a Beta CLI chat on model b1. */
const origin = {
  id: "chat-1",
  title: "Fix login",
  agentKind: "beta",
  model: "b1",
  presentationMode: "terminal" as const,
};

const originSeat = {
  id: "origin:chat-1",
  label: "Beta · One",
  role: "member",
  brain: { kind: "agent", agentKind: "beta", model: "b1", presentationMode: "terminal" },
};

function message(text: string, mentioned = [alpha!]) {
  return { origin, projectId: "project-1", text, mentioned, targets };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRoundtableChatLinksStore.setState({ links: {} });
  resetKnownRoundtables();
  let next = 0;
  api.startRoundtable.mockImplementation(async () => `rt-${++next}`);
  api.postToRoundtable.mockResolvedValue(undefined);
  api.addRoundtableParticipants.mockResolvedValue(undefined);
});

describe("postMentionedRoundtableMessage", () => {
  it("starts an open Roundtable with this chat in seat 0 on the first mention, then posts", async () => {
    const result = await postMentionedRoundtableMessage(message("@Alpha · One thoughts?"), () => 5);
    expect(result).toEqual({ sessionId: "rt-1", created: true });
    expect(api.startRoundtable).toHaveBeenCalledWith({
      task: "@Alpha · One thoughts?",
      pattern: "open",
      projectId: "project-1",
      originThreadId: "chat-1",
      worktree: { mode: "current" },
      participants: [
        // The engine binds `originThreadId` to the first participant: the chat's own agent.
        originSeat,
        {
          id: "model:alpha:a1",
          label: "Alpha · One",
          role: "member",
          brain: { kind: "agent", agentKind: "alpha", model: "a1", presentationMode: "gui" },
        },
      ],
    });
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt-1", "@Alpha · One thoughts?", {
      mentions: ["model:alpha:a1"],
    });
    expect(getRoundtableChatLink("chat-1")).toMatchObject({ sessionId: "rt-1", updatedAt: 5 });
  });

  it("reuses the chat's Roundtable when everyone mentioned is already seated", async () => {
    await postMentionedRoundtableMessage(message("@Alpha · One first"));
    api.startRoundtable.mockClear();
    const result = await postMentionedRoundtableMessage(message("@Alpha · One again"));
    expect(result).toEqual({ sessionId: "rt-1", created: false });
    expect(api.startRoundtable).not.toHaveBeenCalled();
    expect(api.postToRoundtable).toHaveBeenLastCalledWith("rt-1", "@Alpha · One again", {
      mentions: ["model:alpha:a1"],
    });
  });

  it("adds someone newly mentioned to the chat's Roundtable instead of starting another", async () => {
    await postMentionedRoundtableMessage(message("@Alpha · One first"));
    const result = await postMentionedRoundtableMessage(message("@Beta · One join us", [beta!]));
    expect(result).toEqual({ sessionId: "rt-1", created: false });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(api.addRoundtableParticipants).toHaveBeenCalledWith("rt-1", [
      expect.objectContaining({ id: "model:beta:b1" }),
    ]);
    expect(api.postToRoundtable).toHaveBeenLastCalledWith("rt-1", "@Beta · One join us", {
      mentions: ["model:beta:b1"],
    });
    expect(getRoundtableChatLink("chat-1")?.participants.map((seat) => seat.id)).toEqual([
      "origin:chat-1",
      "model:alpha:a1",
      "model:beta:b1",
    ]);
  });

  it("drops a link the engine no longer lists and starts fresh", async () => {
    setRoundtableChatLink("chat-1", {
      sessionId: "gone",
      participants: [
        {
          id: "model:alpha:a1",
          label: "Alpha · One",
          role: "member",
          brain: { kind: "agent", agentKind: "alpha", model: "a1", presentationMode: "gui" },
        },
      ],
      updatedAt: 1,
    });
    syncKnownRoundtables([
      {
        id: "other",
        title: "Other",
        pattern: "open",
        status: "running",
        participantCount: 2,
        updatedAt: 1,
      },
    ]);
    const result = await postMentionedRoundtableMessage(message("@Alpha · One hi"));
    expect(result.created).toBe(true);
    expect(api.postToRoundtable).not.toHaveBeenCalledWith(
      "gone",
      expect.anything(),
      expect.anything(),
    );
  });

  it("treats an empty session list as authoritative once sessions were seen", async () => {
    await postMentionedRoundtableMessage(message("@Alpha · One first"));
    // Before the engine list is known (or while it is still empty after start-up) the link holds.
    syncKnownRoundtables([]);
    expect((await postMentionedRoundtableMessage(message("@Alpha · One again"))).created).toBe(
      false,
    );
    syncKnownRoundtables([
      {
        id: "rt-1",
        title: "",
        pattern: "open",
        status: "running",
        participantCount: 2,
        updatedAt: 1,
      },
    ]);
    // The user then deleted it: the next mention starts a fresh Roundtable.
    syncKnownRoundtables([]);
    expect(await postMentionedRoundtableMessage(message("@Alpha · One back?"))).toEqual({
      sessionId: "rt-2",
      created: true,
    });
  });

  it("refuses to seat more than five, this chat included", async () => {
    const many = buildRoundtableMentionTargets([
      {
        agentKind: "gamma",
        label: "Gamma",
        models: [1, 2, 3, 4, 5].map((index) => ({ id: `g${index}`, label: `G${index}` })),
        defaultModel: "g1",
        presentationModes: ["gui"],
      },
    ]);
    const seated = [
      ...many,
      ...buildRoundtableMentionTargets([
        {
          agentKind: "delta",
          label: "Delta",
          models: [
            { id: "d1", label: "D1" },
            { id: "d2", label: "D2" },
          ],
          defaultModel: "d1",
          presentationModes: ["gui"],
        },
      ]),
    ];
    await expect(
      postMentionedRoundtableMessage({
        origin,
        projectId: "project-1",
        text: "everyone",
        mentioned: seated,
        targets: seated,
      }),
    ).rejects.toThrow(/up to 5 participants/);
    expect(api.startRoundtable).not.toHaveBeenCalled();
  });

  it("reports who cannot join instead of starting a second Roundtable", async () => {
    await postMentionedRoundtableMessage(message("@Alpha · One first"));
    api.addRoundtableParticipants.mockRejectedValueOnce(
      new RoundtableInputError("A Roundtable seats up to 5 participants."),
    );
    await expect(
      postMentionedRoundtableMessage(message("@Beta · One join us", [beta!])),
    ).rejects.toThrow(/up to 5 participants/);
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(getRoundtableChatLink("chat-1")?.sessionId).toBe("rt-1");
  });

  it("starts a fresh Roundtable when the linked one no longer takes messages", async () => {
    await postMentionedRoundtableMessage(message("@Alpha · One first"));
    api.postToRoundtable.mockRejectedValueOnce(new Error("This Roundtable no longer exists."));
    await expect(postMentionedRoundtableMessage(message("@Alpha · One again"))).resolves.toEqual({
      sessionId: "rt-2",
      created: true,
    });
    // The message reaches the new session instead of being lost.
    expect(api.postToRoundtable).toHaveBeenLastCalledWith("rt-2", "@Alpha · One again", {
      mentions: [alpha!.id],
    });
    expect(getRoundtableChatLink("chat-1")?.sessionId).toBe("rt-2");
  });

  it("reports a failure when the fresh Roundtable cannot take the message either", async () => {
    await postMentionedRoundtableMessage(message("@Alpha · One first"));
    api.postToRoundtable
      .mockRejectedValueOnce(new Error("This Roundtable no longer exists."))
      .mockRejectedValueOnce(new Error("still failing"));
    await expect(postMentionedRoundtableMessage(message("@Alpha · One again"))).rejects.toThrow(
      "still failing",
    );
  });
});
