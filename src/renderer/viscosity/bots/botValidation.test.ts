import { describe, expect, it } from "vitest";
import type { ReadyAgentBrain } from "../roundtable/api";
import type { ParticipantBrain } from "../roundtable/types";
import {
  type BotDraft,
  type BotDraftValidationContext,
  botToDraft,
  defaultXaiBrain,
  draftToBotInput,
  emptyBotDraft,
  validateBotDraft,
} from "./botValidation";

const READY: ReadyAgentBrain[] = [
  {
    agentKind: "provider-a",
    label: "Provider A",
    models: [{ id: "model-1", label: "Model 1" }],
    defaultModel: "model-1",
    presentationModes: ["gui", "terminal"],
  },
  {
    agentKind: "provider-b",
    agentInstanceId: "provider-b:work",
    label: "Provider B (work)",
    models: [{ id: "model-b", label: "Model B" }],
    defaultModel: "model-b",
    presentationModes: ["terminal"],
  },
];

const agentBrain: ParticipantBrain = {
  kind: "agent",
  agentKind: "provider-a",
  model: "model-1",
  presentationMode: "gui",
};

function context(overrides: Partial<BotDraftValidationContext> = {}): BotDraftValidationContext {
  return {
    readyAgents: READY,
    xaiKeyConfigured: true,
    projectIds: new Set(["project-1"]),
    otherBotNames: ["Planner"],
    ...overrides,
  };
}

function draft(overrides: Partial<BotDraft> = {}): BotDraft {
  return { ...emptyBotDraft("project-1"), name: "Reviewer", brain: agentBrain, ...overrides };
}

describe("validateBotDraft", () => {
  it("accepts a complete agent bot", () => {
    expect(validateBotDraft(draft(), context())).toEqual({ valid: true, errors: {} });
  });

  it("requires a unique, short name (names are @mention handles)", () => {
    expect(validateBotDraft(draft({ name: "   " }), context()).errors.name).toBe("required");
    expect(validateBotDraft(draft({ name: "x".repeat(41) }), context()).errors.name).toBe(
      "too-long",
    );
    expect(validateBotDraft(draft({ name: " planner " }), context()).errors.name).toBe(
      "duplicate-name",
    );
  });

  it("allows one emoji, up to two letters, or blank for initials", () => {
    for (const glyph of ["", "🤖", "👩‍💻", "RB", "é"]) {
      expect(validateBotDraft(draft({ glyph }), context()).errors.glyph).toBeUndefined();
    }
    expect(validateBotDraft(draft({ glyph: "ABC" }), context()).errors.glyph).toBe("invalid-glyph");
  });

  it("needs a brain the engine reports as ready, in a presentation it offers", () => {
    expect(validateBotDraft(draft({ brain: null }), context()).errors.brain).toBe("required");
    expect(
      validateBotDraft(draft({ brain: { ...agentBrain, agentKind: "not-installed" } }), context())
        .errors.brain,
    ).toBe("agent-unavailable");
    expect(
      validateBotDraft(
        draft({
          brain: {
            kind: "agent",
            agentKind: "provider-b",
            agentInstanceId: "provider-b:work",
            model: "model-b",
            presentationMode: "gui",
          },
        }),
        context(),
      ).errors.brain,
    ).toBe("agent-unavailable");
    expect(
      validateBotDraft(draft({ brain: { ...agentBrain, model: " " } }), context()).errors.brain,
    ).toBe("model-required");
  });

  it("keeps an unchanged saved brain even while its agent is signed out", () => {
    const signedOut = context({ readyAgents: [], savedBrain: agentBrain });
    expect(validateBotDraft(draft(), signedOut).errors.brain).toBeUndefined();
    expect(
      validateBotDraft(draft({ brain: { ...agentBrain, model: "model-2" } }), signedOut).errors
        .brain,
    ).toBe("agent-unavailable");
  });

  it("offers a Grok brain only with a configured key and a model the region serves", () => {
    const grok = defaultXaiBrain({ region: "global", tools: { webSearch: true, xSearch: false } });
    expect(grok).toEqual({
      kind: "xai",
      model: "grok-4.7",
      region: "global",
      tools: { webSearch: true, xSearch: false },
    });
    expect(validateBotDraft(draft({ brain: grok }), context()).valid).toBe(true);
    expect(
      validateBotDraft(draft({ brain: grok }), context({ xaiKeyConfigured: false })).errors.brain,
    ).toBe("xai-key-missing");
    expect(
      validateBotDraft(
        draft({ brain: { ...grok, region: "us", model: "grok-imagine-image-2.0" } }),
        context(),
      ).errors.brain,
    ).toBe("xai-model-region");
    expect(
      validateBotDraft(draft({ brain: { ...grok, region: "us", model: "grok-4.6" } }), context())
        .errors.brain,
    ).toBeUndefined();
  });

  it("requires an existing workspace project and bounded notes", () => {
    const result = validateBotDraft(
      draft({ projectId: "gone", instructions: "i".repeat(4_001), memory: "m".repeat(2_001) }),
      context(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({
      project: "project-missing",
      instructions: "too-long",
      memory: "too-long",
    });
  });
});

describe("bot drafts", () => {
  it("round-trips a saved bot and trims what it stores", () => {
    const loaded = botToDraft({
      id: "bot-1",
      label: "Reviewer",
      role: "member",
      brain: agentBrain,
      projectId: "project-1",
      avatar: { glyph: "🦉", color: "project-icon-violet" },
      instructions: "Review.",
      createdAt: 1,
    });
    expect(loaded).toEqual({
      name: "Reviewer",
      glyph: "🦉",
      color: "project-icon-violet",
      brain: agentBrain,
      projectId: "project-1",
      instructions: "Review.",
      memory: "",
    });
    expect(
      draftToBotInput({ ...loaded, name: "  Reviewer 2 ", glyph: " 🦉 ", brain: agentBrain }),
    ).toEqual({
      label: "Reviewer 2",
      brain: agentBrain,
      projectId: "project-1",
      avatar: { glyph: "🦉", color: "project-icon-violet" },
      instructions: "Review.",
      memory: "",
    });
  });
});
