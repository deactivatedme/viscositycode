/**
 * ViscosityCode: the app-owned `/roundtable` composer command.
 *
 * Like upstream's `/btw`, it is a local GUI command: it never reaches the
 * provider. In an existing chat it opens the invite dialog (pick 1–4 more
 * participants and a pattern); in the new-thread composer it switches the
 * draft into Roundtable mode. Terminal-presentation threads get the same
 * through the command palette, because local slash commands are GUI-only.
 */
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { guiSlashCommand } from "@/renderer/components/providers/standardGuiSlashCommands";
import type { LocalSlashCommandAction } from "@/renderer/components/providers/providerSlashCommands";
import type { AgentSlashCommand, ThreadPresentationMode } from "@/shared/contracts";
import { isRoundtableChatAvailable } from "./availability";

export const ROUNDTABLE_COMMAND_ID = "roundtable";
export const ROUNDTABLE_COMMAND_PREFIX = /^\s*\/roundtable(?:\s+|$)/iu;

export interface RoundtableSlashContext {
  presentationMode?: ThreadPresentationMode | undefined;
  /**
   * Whether this composer can host a Roundtable. Omitted means "wherever the
   * desktop shell is active"; surfaces that cannot (an isolated side-chat
   * draft, the home scope) pass `false`.
   */
  supportsRoundtable?: boolean | undefined;
}

export function roundtableSlashAvailable(context: RoundtableSlashContext | undefined): boolean {
  if (context?.presentationMode !== "gui") return false;
  return context.supportsRoundtable ?? isRoundtableChatAvailable();
}

export function roundtableSlashCommand(): AgentSlashCommand {
  return guiSlashCommand(
    ROUNDTABLE_COMMAND_ID,
    i18n._(msg`Seat more models at a Roundtable on this task`),
  );
}

/** `/roundtable <task>` → the task text (may be empty); anything else → null. */
export function parseRoundtableCommand(input: string): { task: string } | null {
  const match = input.match(ROUNDTABLE_COMMAND_PREFIX);
  return match ? { task: input.slice(match[0].length).trim() } : null;
}

export function resolveRoundtableSlashAction(
  input: string,
  context: RoundtableSlashContext,
): Extract<LocalSlashCommandAction, { kind: "open-roundtable" }> | null {
  if (!roundtableSlashAvailable(context)) return null;
  const parsed = parseRoundtableCommand(input);
  return parsed ? { kind: "open-roundtable", task: parsed.task } : null;
}
