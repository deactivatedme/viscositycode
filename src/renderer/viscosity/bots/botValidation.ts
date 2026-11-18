/**
 * ViscosityCode: bot editor form state and validation (fork of Poracode).
 *
 * Validation returns error codes, not text, so the dialog localizes them and
 * tests stay language-independent. Brain checks use only the ready-agent list
 * from the Roundtable engine (installed, enabled, signed in, with models) and
 * the xAI key status: no provider is named here.
 */
import { XAI_DEFAULT_TEXT_MODEL } from "@/shared/viscosity/xaiContract";
import type { ReadyAgentBrain } from "../roundtable/api";
import type { ParticipantBrain } from "../roundtable/types";
import type { BotProfile } from "./api";
import {
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_MEMORY_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  DEFAULT_BOT_AVATAR_COLOR,
  isValidBotGlyph,
  xaiModelsForRegion,
} from "./botModel";
import type { BotXaiDefaults, NewBotInput } from "./botStore";

export interface BotDraft {
  name: string;
  glyph: string;
  color: string;
  brain: ParticipantBrain | null;
  projectId: string;
  instructions: string;
  memory: string;
}

export type BotDraftField = "name" | "glyph" | "brain" | "project" | "instructions" | "memory";

export type BotDraftError =
  | "required"
  | "too-long"
  | "duplicate-name"
  | "invalid-glyph"
  | "agent-unavailable"
  | "model-required"
  | "xai-key-missing"
  | "xai-model-region"
  | "project-missing";

export interface BotDraftValidationContext {
  readyAgents: readonly ReadyAgentBrain[];
  xaiKeyConfigured: boolean;
  projectIds: ReadonlySet<string>;
  /** Names of the user's other bots (the edited bot excluded). */
  otherBotNames: readonly string[];
  /** The saved brain of the bot being edited: an unchanged brain is kept even while unavailable. */
  savedBrain?: ParticipantBrain;
}

export interface BotDraftValidation {
  valid: boolean;
  errors: Partial<Record<BotDraftField, BotDraftError>>;
}

export function emptyBotDraft(projectId: string): BotDraft {
  return {
    name: "",
    glyph: "",
    color: DEFAULT_BOT_AVATAR_COLOR,
    brain: null,
    projectId,
    instructions: "",
    memory: "",
  };
}

export function botToDraft(bot: BotProfile): BotDraft {
  return {
    name: bot.label,
    glyph: bot.avatar?.glyph ?? "",
    color: bot.avatar?.color ?? DEFAULT_BOT_AVATAR_COLOR,
    brain: bot.brain,
    projectId: bot.projectId,
    instructions: bot.instructions ?? "",
    memory: bot.memory ?? "",
  };
}

/** A new Grok brain from the user's Settings → Bots defaults. */
export function defaultXaiBrain(
  defaults: BotXaiDefaults,
): Extract<ParticipantBrain, { kind: "xai" }> {
  return {
    kind: "xai",
    model: XAI_DEFAULT_TEXT_MODEL,
    region: defaults.region,
    tools: { ...defaults.tools },
  };
}

export function sameBrain(a: ParticipantBrain | null | undefined, b: ParticipantBrain | undefined) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "agent" && b.kind === "agent") {
    return (
      a.agentKind === b.agentKind &&
      (a.agentInstanceId ?? "") === (b.agentInstanceId ?? "") &&
      a.model === b.model &&
      a.presentationMode === b.presentationMode
    );
  }
  if (a.kind === "xai" && b.kind === "xai") {
    return (
      a.model === b.model &&
      a.region === b.region &&
      a.tools.webSearch === b.tools.webSearch &&
      a.tools.xSearch === b.tools.xSearch
    );
  }
  return false;
}

function brainError(
  brain: ParticipantBrain | null,
  context: BotDraftValidationContext,
): BotDraftError | undefined {
  if (!brain) return "required";
  if (!brain.model.trim()) return "model-required";
  if (sameBrain(brain, context.savedBrain)) return undefined;
  if (brain.kind === "agent") {
    const ready = context.readyAgents.find(
      (agent) =>
        agent.agentKind === brain.agentKind &&
        (agent.agentInstanceId ?? "") === (brain.agentInstanceId ?? ""),
    );
    if (!ready || !ready.presentationModes.includes(brain.presentationMode)) {
      return "agent-unavailable";
    }
    return undefined;
  }
  if (!context.xaiKeyConfigured) return "xai-key-missing";
  if (!xaiModelsForRegion(brain.region).includes(brain.model)) return "xai-model-region";
  return undefined;
}

export function validateBotDraft(
  draft: BotDraft,
  context: BotDraftValidationContext,
): BotDraftValidation {
  const errors: Partial<Record<BotDraftField, BotDraftError>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > BOT_NAME_MAX_LENGTH) errors.name = "too-long";
  else if (
    context.otherBotNames.some(
      (other) => other.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    // Names are how people @mention bots in group chats, so they must be unique.
    errors.name = "duplicate-name";
  }
  if (!isValidBotGlyph(draft.glyph)) errors.glyph = "invalid-glyph";
  const brain = brainError(draft.brain, context);
  if (brain) errors.brain = brain;
  if (!draft.projectId || !context.projectIds.has(draft.projectId))
    errors.project = "project-missing";
  if (draft.instructions.trim().length > BOT_INSTRUCTIONS_MAX_LENGTH) {
    errors.instructions = "too-long";
  }
  if (draft.memory.trim().length > BOT_MEMORY_MAX_LENGTH) errors.memory = "too-long";
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Store input for a draft that passed validation. */
export function draftToBotInput(draft: BotDraft & { brain: ParticipantBrain }): NewBotInput {
  return {
    label: draft.name.trim(),
    brain: draft.brain,
    projectId: draft.projectId,
    avatar: { glyph: draft.glyph.trim(), color: draft.color },
    instructions: draft.instructions,
    memory: draft.memory,
  };
}
