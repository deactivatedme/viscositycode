/**
 * ViscosityCode: Bots public API (contract) — Codync-style persistent, named
 * AI teammates. A bot is a saved participant profile (name, avatar, standing
 * instructions, brain = any installed agent/model or a Grok model over the
 * xAI API, workspace project, short memory) with one ongoing chat. Bot group
 * chats are Roundtables in the "open" pattern.
 *
 * Other features import ONLY from this module. Signatures are the contract.
 */
import type { ParticipantProfile } from "../roundtable/types";
import { isViscosityShellActive } from "../shellFlag";
import { openBotChat, startGroupChat } from "./botActions";
import { selectBotList, useBotsStore } from "./botStore";
import { openBotEditor } from "./ui/botsDialogStore";

export interface BotProfile extends ParticipantProfile {
  projectId: string;
  /** Short notes the bot keeps between chats; appended to its instructions. */
  memory?: string;
  /** Current chat thread for agent brains; conversation id for API brains. */
  chatId?: string;
  createdAt: number;
}

/** The user's bots in display order (stable until a bot changes). */
export function useBots(): BotProfile[] {
  return useBotsStore(selectBotList);
}

export function useBot(botId: string | undefined): BotProfile | undefined {
  return useBotsStore((state) => (botId ? state.bots[botId] : undefined));
}

/** Open the bot's ongoing chat (agent brain → its thread in a pane; API brain → native chat panel). */
export function openBot(botId: string): Promise<void> {
  return openBotChat(botId);
}

/** Start (or reopen) a group chat with these bots; returns the Roundtable session id. */
export function startBotGroupChat(
  botIds: string[],
  projectId: string,
  title?: string,
): Promise<string> {
  return startGroupChat(botIds, projectId, title);
}

/**
 * Open the "New bot" editor in place (no view switch). Bot dialogs render only
 * in the desktop shell, so this does nothing anywhere else.
 */
export function openNewBotEditor(): void {
  if (!isViscosityShellActive()) return;
  openBotEditor();
}
