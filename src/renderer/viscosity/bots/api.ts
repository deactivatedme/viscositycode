/**
 * ViscosityCode: Bots public API (contract) — Codync-style persistent, named
 * AI teammates. A bot is a saved participant profile (name, avatar, standing
 * instructions, brain = any installed agent/model or a Grok model over the
 * xAI API, workspace project, short memory) with one ongoing chat. Bot group
 * chats are Roundtables in the "open" pattern.
 *
 * Other features import ONLY from this module; the Bots agent replaces these
 * placeholders. Signatures are the contract.
 */
import type { ParticipantProfile } from "../roundtable/types";

export interface BotProfile extends ParticipantProfile {
  projectId: string;
  /** Short notes the bot keeps between chats; appended to its instructions. */
  memory?: string;
  /** Current chat thread for agent brains; conversation id for API brains. */
  chatId?: string;
  createdAt: number;
}

export function useBots(): BotProfile[] {
  return [];
}
export function useBot(_botId: string | undefined): BotProfile | undefined {
  return undefined;
}
/** Open the bot's ongoing chat (agent brain → its thread in a pane; API brain → native chat panel). */
export function openBot(_botId: string): Promise<void> {
  return Promise.reject(new Error("Bots not available yet"));
}
/** Start (or reopen) a group chat with these bots; returns the Roundtable session id. */
export function startBotGroupChat(
  _botIds: string[],
  _projectId: string,
  _title?: string,
): Promise<string> {
  return Promise.reject(new Error("Bots not available yet"));
}
