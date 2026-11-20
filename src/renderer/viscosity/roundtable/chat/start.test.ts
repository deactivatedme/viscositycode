import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadyAgentBrain } from "../api";
import {
  getRoundtableChatLink,
  resetKnownRoundtables,
  useRoundtableChatLinksStore,
} from "./chatLinksStore";
import { buildRoundtableMentionTargets } from "./mentions";
import { postMentionedRoundtableMessage } from "./mentionRouting";
import { invitedSeatProfiles, type OriginChat } from "./participants";
import { startRoundtableFromChat } from "./start";

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
];
const targets = buildRoundtableMentionTargets(brains);
const origin: OriginChat = {
  id: "chat-1",
  title: "Fix login",
  agentKind: "beta",
  model: "b1",
  presentationMode: "terminal",
};

beforeEach(() => {
  vi.clearAllMocks();
  useRoundtableChatLinksStore.setState({ links: {} });
  resetKnownRoundtables();
  api.startRoundtable.mockResolvedValue("rt-invited");
  api.postToRoundtable.mockResolvedValue(undefined);
  api.addRoundtableParticipants.mockResolvedValue(undefined);
});

describe("startRoundtableFromChat", () => {
  it("links an open chat started from a chat, so its next @mention goes to the same Roundtable", async () => {
    const candidates = targets.map((target) => target.candidate);
    const participants = invitedSeatProfiles("open", origin, candidates, candidates);
    await startRoundtableFromChat({
      task: "Plan the fix",
      pattern: "open",
      projectId: "project-1",
      participants,
      originThreadId: "chat-1",
    });
    expect(getRoundtableChatLink("chat-1")).toMatchObject({
      sessionId: "rt-invited",
      participants,
    });
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt-invited", "Plan the fix");

    const result = await postMentionedRoundtableMessage({
      origin,
      projectId: "project-1",
      text: "@Alpha · One and now?",
      mentioned: [targets[0]!],
      targets,
    });
    expect(result).toEqual({ sessionId: "rt-invited", created: false });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(api.addRoundtableParticipants).not.toHaveBeenCalled();
  });

  it("links nothing for other patterns or without an origin chat", async () => {
    await startRoundtableFromChat({
      task: "Fix it",
      pattern: "build-review",
      projectId: "project-1",
      participants: [],
      originThreadId: "chat-1",
    });
    await startRoundtableFromChat({
      task: "Hi",
      pattern: "open",
      projectId: "project-1",
      participants: [],
    });
    expect(useRoundtableChatLinksStore.getState().links).toEqual({});
  });
});
