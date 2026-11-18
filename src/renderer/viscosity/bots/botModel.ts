/**
 * ViscosityCode: Bots data model helpers (fork of Poracode).
 *
 * Pure functions shared by the store, the editor and the actions: avatar
 * palette, limits, sanitizing persisted profiles, and converting a bot into
 * the plain participant profile the Roundtable engine seats. Nothing here
 * branches on a provider: an agent brain's `agentKind` is opaque.
 */
import {
  XAI_DEFAULT_TEXT_MODEL,
  XAI_US_TEXT_MODELS,
  type XaiRegion,
} from "@/shared/viscosity/xaiContract";
import type { ParticipantBrain, ParticipantProfile } from "../roundtable/types";
import type { BotProfile } from "./api";

export const BOT_NAME_MAX_LENGTH = 40;
export const BOT_INSTRUCTIONS_MAX_LENGTH = 4_000;
export const BOT_MEMORY_MAX_LENGTH = 2_000;
/** Grapheme clusters an avatar glyph may hold (one emoji, or 1–2 letters). */
export const BOT_GLYPH_MAX_GRAPHEMES = 2;
/** Hard cap on the stored glyph string (emoji sequences are long in code units). */
const BOT_GLYPH_MAX_CODE_UNITS = 16;

/**
 * Avatar colours: theme tokens (CSS custom property names) so every preset —
 * light, dark, custom — recolours them: the accent plus the theme's project
 * icon palette. A stored colour may also be a hex value. Token names are what
 * the Roundtable avatar renders as `var(--<token>)`.
 */
export const BOT_AVATAR_COLORS = [
  "accent",
  "project-icon-blue",
  "project-icon-violet",
  "project-icon-pink",
  "project-icon-red",
  "project-icon-orange",
  "project-icon-amber",
  "project-icon-green",
  "project-icon-teal",
] as const;
export type BotAvatarColor = (typeof BOT_AVATAR_COLORS)[number];
export const DEFAULT_BOT_AVATAR_COLOR: BotAvatarColor = "accent";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isBotAvatarColor(value: unknown): value is BotAvatarColor {
  return typeof value === "string" && (BOT_AVATAR_COLORS as readonly string[]).includes(value);
}

/** CSS colour for a stored avatar colour (palette token or hex); unknown values fall back. */
export function botAvatarColorCss(color: string | undefined): string {
  if (isBotAvatarColor(color)) return `var(--${color})`;
  if (color && HEX_COLOR.test(color)) return color;
  return `var(--${DEFAULT_BOT_AVATAR_COLOR})`;
}

function graphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

export function countGraphemes(value: string): number {
  return graphemes(value).length;
}

/** Up to two initials from a name ("Review Buddy" → "RB", "ada" → "A"). */
export function botInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => graphemes(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase() || "?";
}

/** The glyph to draw: the stored one, or the name's initials when it is blank. */
export function botAvatarGlyph(bot: Pick<BotProfile, "label" | "avatar">): string {
  const glyph = bot.avatar?.glyph.trim();
  return glyph ? glyph : botInitials(bot.label);
}

export function isValidBotGlyph(glyph: string): boolean {
  const trimmed = glyph.trim();
  if (trimmed.length === 0) return true; // blank → initials
  return (
    trimmed.length <= BOT_GLYPH_MAX_CODE_UNITS && countGraphemes(trimmed) <= BOT_GLYPH_MAX_GRAPHEMES
  );
}

/** Text models offered for a Grok bot; the default (flagship) model first. */
const XAI_GLOBAL_TEXT_MODELS: readonly string[] = [
  ...new Set<string>([XAI_DEFAULT_TEXT_MODEL, ...XAI_US_TEXT_MODELS]),
];

/** Text models the region serves; the US endpoint only serves the listed text models. */
export function xaiModelsForRegion(region: XaiRegion): readonly string[] {
  return region === "us" ? XAI_US_TEXT_MODELS : XAI_GLOBAL_TEXT_MODELS;
}

export function isAgentBrain(
  brain: ParticipantBrain,
): brain is Extract<ParticipantBrain, { kind: "agent" }> {
  return brain.kind === "agent";
}

export function isXaiBrain(
  brain: ParticipantBrain,
): brain is Extract<ParticipantBrain, { kind: "xai" }> {
  return brain.kind === "xai";
}

/**
 * The participant profile the Roundtable engine seats for a bot. The bot's
 * memory travels with its standing instructions; the engine quotes peers as
 * context and never grants a bot more than its provider's defaults.
 */
export function botToParticipant(bot: BotProfile): ParticipantProfile {
  const instructions = joinInstructions(bot.instructions, bot.memory);
  return {
    id: bot.id,
    label: bot.label,
    role: "member",
    brain: bot.brain,
    ...(instructions ? { instructions } : {}),
    // A blank glyph means "initials": seat the bot with the glyph it is drawn with.
    avatar: { glyph: botAvatarGlyph(bot), color: bot.avatar?.color ?? DEFAULT_BOT_AVATAR_COLOR },
  };
}

function joinInstructions(
  instructions: string | undefined,
  memory: string | undefined,
): string | undefined {
  const parts = [
    instructions?.trim(),
    memory?.trim() ? `Memory notes:\n${memory.trim()}` : undefined,
  ];
  const text = parts.filter((part): part is string => Boolean(part)).join("\n\n");
  return text || undefined;
}

// ---------------------------------------------------------------------------
// Sanitizing persisted data (store migrate/merge). Anything malformed is
// dropped rather than trusted: the blob lives in this desktop's database and a
// newer or older build may have written it.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, max);
  return trimmed.trim() ? trimmed : undefined;
}

function sanitizeBrain(value: unknown): ParticipantBrain | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "agent") {
    if (typeof value.agentKind !== "string" || !value.agentKind) return undefined;
    if (typeof value.model !== "string" || !value.model) return undefined;
    const presentationMode = value.presentationMode === "terminal" ? "terminal" : "gui";
    return {
      kind: "agent",
      agentKind: value.agentKind,
      ...(typeof value.agentInstanceId === "string" && value.agentInstanceId
        ? { agentInstanceId: value.agentInstanceId }
        : {}),
      model: value.model,
      presentationMode,
    };
  }
  if (value.kind === "xai") {
    const region: XaiRegion = value.region === "us" ? "us" : "global";
    const model =
      typeof value.model === "string" && xaiModelsForRegion(region).includes(value.model)
        ? value.model
        : XAI_DEFAULT_TEXT_MODEL;
    const tools = isRecord(value.tools) ? value.tools : {};
    return {
      kind: "xai",
      model,
      region,
      tools: { webSearch: tools.webSearch === true, xSearch: tools.xSearch === true },
    };
  }
  return undefined;
}

/** A persisted bot, or undefined when it cannot be trusted. */
export function sanitizeBotProfile(value: unknown): BotProfile | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !value.id) return undefined;
  if (typeof value.projectId !== "string" || !value.projectId) return undefined;
  const label = optionalString(value.label, BOT_NAME_MAX_LENGTH)?.trim();
  if (!label) return undefined;
  const brain = sanitizeBrain(value.brain);
  if (!brain) return undefined;
  const avatarSource = isRecord(value.avatar) ? value.avatar : undefined;
  const storedGlyph =
    typeof avatarSource?.glyph === "string" && isValidBotGlyph(avatarSource.glyph)
      ? avatarSource.glyph.trim()
      : "";
  // Always a drawable glyph: every avatar renderer (Roundtable seats too) shows it as is.
  const glyph = storedGlyph || botInitials(label);
  const color =
    typeof avatarSource?.color === "string" &&
    (isBotAvatarColor(avatarSource.color) || HEX_COLOR.test(avatarSource.color))
      ? avatarSource.color
      : DEFAULT_BOT_AVATAR_COLOR;
  const instructions = optionalString(value.instructions, BOT_INSTRUCTIONS_MAX_LENGTH);
  const memory = optionalString(value.memory, BOT_MEMORY_MAX_LENGTH);
  const chatId = typeof value.chatId === "string" && value.chatId ? value.chatId : undefined;
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : 0;
  return {
    id: value.id,
    label,
    role: "member",
    brain,
    projectId: value.projectId,
    avatar: { glyph, color },
    ...(instructions ? { instructions } : {}),
    ...(memory ? { memory } : {}),
    ...(chatId ? { chatId } : {}),
    createdAt,
  };
}
