/**
 * ViscosityCode: Playbooks — a named way of working ("Reversing", "Review", …)
 * that a chat runs under: standing instructions for the agent, the MCP servers
 * it switches on, and presentation hints for the renderer (theme, switch
 * animation lines).
 *
 * Two persisted shapes live here:
 * - `ThreadConfig.playbook` — a frozen, versioned copy bound to one chat.
 *   Absent means none (or an older writer, so updates retain the previous
 *   value); `null` is an explicit clear; a future version is kept as-is and
 *   has no effect (same rules as the crew binding in `../crew.ts`).
 *   Downgrade: an older app that rewrites the config strips the field, so the
 *   chat loses its playbook and nothing else; the transcript keeps the brief.
 * - The host setting `playbooks` — custom playbooks and edited built-ins
 *   (an entry whose id equals a built-in id). Unversioned like saved crews:
 *   every field beyond the core is optional, and malformed entries are
 *   dropped one by one on load.
 */
import { z } from "zod";

export const PLAYBOOK_BINDING_VERSION = 1;
export const MAX_SAVED_PLAYBOOKS = 48;
export const PLAYBOOK_LABEL_MAX_LENGTH = 32;
export const PLAYBOOK_INSTRUCTIONS_MAX_LENGTH = 6000;
export const PLAYBOOK_DESCRIPTION_MAX_LENGTH = 120;
export const PLAYBOOK_ICON_MAX_LENGTH = 48;
export const MAX_PLAYBOOK_MCP_NAMES = 12;
export const PLAYBOOK_MCP_NAME_MAX_LENGTH = 64;
export const MAX_PLAYBOOK_MCP_SERVER_IDS = 16;
export const MAX_PLAYBOOK_PHRASES = 10; // Raised from 6 before any release shipped playbooks.
export const PLAYBOOK_PHRASE_MAX_LENGTH = 40;

export const playbookIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);
/** Built-in preset ids (`viscosity-blue`) and imported ones (`custom:night`). */
export const playbookThemeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/);

// Controls, invisible format characters (bidi, zero-width) and line separators.
// An explicit class instead of \p{…} so the native protocol emitters can match it.
const PHRASE_UNSAFE_CLASS =
  "\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff";
const PHRASE_UNSAFE_CHARS = new RegExp(`[${PHRASE_UNSAFE_CLASS}]`, "g");
const PHRASE_PATTERN = new RegExp(
  `^[^ ${PHRASE_UNSAFE_CLASS}](?:[^${PHRASE_UNSAFE_CLASS}]*[^ ${PHRASE_UNSAFE_CLASS}])?$`,
);

/** One switch-animation line in canonical form: one line, trimmed, capped; "" when nothing is left. */
export function sanitizePlaybookPhrase(value: string): string {
  let phrase = "";
  for (const char of value.replace(PHRASE_UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim()) {
    if (phrase.length + char.length > PLAYBOOK_PHRASE_MAX_LENGTH) break;
    phrase += char;
  }
  return phrase.trim();
}

/** Canonical phrase list for editors: sanitized, empties and duplicates dropped, capped. */
export function sanitizePlaybookPhrases(values: readonly string[]): string[] {
  const phrases: string[] = [];
  for (const value of values) {
    const phrase = sanitizePlaybookPhrase(value);
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
    if (phrases.length === MAX_PLAYBOOK_PHRASES) break;
  }
  return phrases;
}

const playbookPhraseSchema = z.string().max(PLAYBOOK_PHRASE_MAX_LENGTH).regex(PHRASE_PATTERN);
const playbookPhrasesSchema = z.array(playbookPhraseSchema).min(1).max(MAX_PLAYBOOK_PHRASES);

const playbookCoreShape = {
  id: playbookIdSchema,
  label: z.string().min(1).max(PLAYBOOK_LABEL_MAX_LENGTH),
  /** Lucide kebab-case name; the renderer allowlists it and falls back to its own icon. */
  icon: z.string().min(1).max(PLAYBOOK_ICON_MAX_LENGTH).optional(),
  /** Asks the agent not to edit files (instruction strength, like crew `noEdits`). */
  readOnly: z.literal(true).optional(),
  instructions: z.string().min(1).max(PLAYBOOK_INSTRUCTIONS_MAX_LENGTH),
  /** Theme preset the renderer may apply while this chat is on screen; unknown ids are ignored. */
  themeId: playbookThemeIdSchema.optional(),
  /** Short lines the switch animation shows when this playbook is turned on. */
  switchPhrases: playbookPhrasesSchema.optional(),
  /** Short lines the switch animation shows when this playbook is turned off. */
  exitPhrases: playbookPhrasesSchema.optional(),
};

export const threadPlaybookBindingSchema = z
  .object({
    version: z.literal(PLAYBOOK_BINDING_VERSION),
    ...playbookCoreShape,
    /** MCP server ids this playbook switched on, so a switch can revert them without the catalog. */
    mcpServerIds: z.array(z.string().min(1)).max(MAX_PLAYBOOK_MCP_SERVER_IDS).optional(),
  })
  .strict();

export const unsupportedThreadPlaybookBindingSchema = z.looseObject({
  version: z
    .number()
    .int()
    .min(PLAYBOOK_BINDING_VERSION + 1),
});

export const threadConfigPlaybookSchema = z
  .union([threadPlaybookBindingSchema, unsupportedThreadPlaybookBindingSchema])
  .nullable();

export const savedPlaybookSchema = z.object({
  ...playbookCoreShape,
  description: z.string().max(PLAYBOOK_DESCRIPTION_MAX_LENGTH).optional(),
  /** MCP server names (not ids), matched exactly and case-insensitively when applied. */
  mcp: z
    .array(z.string().min(1).max(PLAYBOOK_MCP_NAME_MAX_LENGTH))
    .max(MAX_PLAYBOOK_MCP_NAMES)
    .optional(),
  browserMcp: z.literal(true).optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});

export const savedPlaybooksSchema = z.array(savedPlaybookSchema).max(MAX_SAVED_PLAYBOOKS);

export type ThreadPlaybookBinding = z.infer<typeof threadPlaybookBindingSchema>;
export type ThreadConfigPlaybook = z.infer<typeof threadConfigPlaybookSchema>;
export type SavedPlaybook = z.infer<typeof savedPlaybookSchema>;

/** The chat's v1 playbook, or undefined for none, null, malformed or a future version. */
export function threadPlaybookBinding(
  config: { playbook?: ThreadConfigPlaybook | undefined } | undefined,
): ThreadPlaybookBinding | undefined {
  const parsed = threadPlaybookBindingSchema.safeParse(config?.playbook);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Identity of what the agent is told. Icon, MCP ids, theme and phrases are
 * presentation or launch details and never re-send the brief.
 */
export function playbookFingerprint(binding: ThreadPlaybookBinding | undefined): string {
  if (!binding) return "";
  return canonicalJson({
    id: binding.id,
    label: binding.label,
    readOnly: binding.readOnly,
    instructions: binding.instructions,
  });
}

/** Null and absence both mean no playbook at runtime; retention preserves their wire difference. */
export function isThreadConfigPlaybookEqual(
  left: ThreadConfigPlaybook | undefined,
  right: ThreadConfigPlaybook | undefined,
): boolean {
  return canonicalJson(left ?? undefined) === canonicalJson(right ?? undefined);
}

/** A frozen v1 copy of a catalog entry for `ThreadConfig.playbook`. */
export function playbookBindingFromSaved(
  playbook: SavedPlaybook,
  mcpServerIds?: readonly string[],
): ThreadPlaybookBinding {
  return threadPlaybookBindingSchema.parse({
    version: PLAYBOOK_BINDING_VERSION,
    id: playbook.id,
    label: playbook.label,
    ...(playbook.icon !== undefined ? { icon: playbook.icon } : {}),
    ...(playbook.readOnly ? { readOnly: true } : {}),
    instructions: playbook.instructions,
    ...(playbook.themeId !== undefined ? { themeId: playbook.themeId } : {}),
    ...(playbook.switchPhrases !== undefined ? { switchPhrases: playbook.switchPhrases } : {}),
    ...(playbook.exitPhrases !== undefined ? { exitPhrases: playbook.exitPhrases } : {}),
    ...(mcpServerIds && mcpServerIds.length > 0
      ? { mcpServerIds: [...new Set(mcpServerIds)].slice(0, MAX_PLAYBOOK_MCP_SERVER_IDS) }
      : {}),
  });
}

/**
 * Load-time salvage of the `playbooks` host setting: a malformed or duplicate
 * entry drops alone, and hand-edited phrase lists are canonicalized first so
 * one long line does not lose the whole playbook. Valid stored entries come
 * back unchanged.
 */
export function normalizeSavedPlaybooks(value: unknown): SavedPlaybook[] {
  if (!Array.isArray(value)) return [];
  const playbooks: SavedPlaybook[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const parsed = savedPlaybookSchema.safeParse(withSanitizedPhrases(entry));
    if (!parsed.success || ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    playbooks.push(parsed.data);
    if (playbooks.length === MAX_SAVED_PLAYBOOKS) break;
  }
  return playbooks;
}

function withSanitizedPhrases(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const next: Record<string, unknown> = { ...entry };
  for (const key of ["switchPhrases", "exitPhrases"] as const) {
    const phrases = next[key];
    if (phrases === undefined) continue;
    const sanitized = Array.isArray(phrases)
      ? sanitizePlaybookPhrases(phrases.filter((item): item is string => typeof item === "string"))
      : [];
    if (sanitized.length > 0) next[key] = sanitized;
    else delete next[key];
  }
  return next;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value).filter(([, member]) => member !== undefined);
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
}
