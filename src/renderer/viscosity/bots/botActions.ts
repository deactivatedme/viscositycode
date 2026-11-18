/**
 * ViscosityCode: what opening, restarting and grouping bots does (fork of
 * Poracode). `api.ts` re-exports the public pieces.
 *
 * - Agent brain: the bot's ongoing thread (created once, see
 *   `botAgentThread.ts`) is shown in the focused pane, like a tab press.
 * - API brain: the bot's chat opens in the center chat panel.
 * - Group chat: a Roundtable in the "open" pattern seating the bots, started
 *   through the Roundtable engine's public API; its tab is added without
 *   switching to it, and it opens in the Roundtable center panel on a click.
 */
import { toast } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { activateThreadTab } from "@/renderer/viscosity/layout/tabs/tabActions";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { hideRoundtablePanel, openRoundtableTab } from "@/renderer/viscosity/roundtable";
import { startRoundtable } from "../roundtable/api";
import { ensureAgentBotThread, liveBotThreadId } from "./botAgentThread";
import { ensureBotApiChat, forgetBotApiChat, restartBotApiChat } from "./botApiChat";
import { closeBotChatPanel, useBotChatPanelStore } from "./botChatPanelStore";
import { botToParticipant } from "./botModel";
import { getBot, type NewBotInput, useBotsStore, whenBotsHydrated } from "./botStore";
import { sameBrain } from "./botValidation";

/** A Roundtable seats 2–5 participants. */
export const BOT_GROUP_CHAT_MIN_BOTS = 2;
export const BOT_GROUP_CHAT_MAX_BOTS = 5;

function botNotFound(): Error {
  return new Error(i18n._(msg`This bot no longer exists.`));
}

/** Show a thread in the focused pane (and bring it in front of an open bot chat panel). */
function showThread(threadId: string): void {
  closeBotChatPanel();
  activateThreadTab(threadId);
}

export async function openBotChat(botId: string): Promise<void> {
  await whenBotsHydrated();
  const bot = getBot(botId);
  if (!bot) throw botNotFound();
  if (bot.brain.kind === "agent") {
    const existing = liveBotThreadId(bot);
    if (existing) {
      showThread(existing);
      return;
    }
    await ensureAgentBotThread(bot, showThread);
    return;
  }
  // The chat panel lives in the desktop shell's center column.
  if (!isViscosityShellActive()) {
    toast.info(i18n._(msg`Grok bot chats open in the desktop layout.`));
    return;
  }
  ensureBotApiChat(bot.id);
  showBotChatPanel(bot.id);
}

/** The center chat panel of an API bot, in front of the panes and any open Roundtable. */
function showBotChatPanel(botId: string): void {
  hideRoundtablePanel();
  useBotChatPanelStore.getState().open(botId);
}

/**
 * "New session": the bot keeps its profile but forgets the conversation. An
 * agent bot's previous thread stays in the sidebar as an ordinary thread.
 */
export async function startNewBotSession(botId: string): Promise<void> {
  await whenBotsHydrated();
  const bot = getBot(botId);
  if (!bot) throw botNotFound();
  if (bot.brain.kind === "xai") {
    await restartBotApiChat(botId);
    showBotChatPanel(botId);
    return;
  }
  useBotsStore.getState().setBotChatId(botId, undefined);
  await openBotChat(botId);
}

/**
 * Saves an edited bot. An agent bot whose agent, model, presentation or
 * project changed cannot continue its thread, so the next open starts a new
 * one (the old thread stays in the sidebar); the same goes for a switch
 * between an agent and an API brain. A Grok bot keeps its chat across model,
 * region and tool changes: they apply to its next reply.
 */
export async function saveBotEdits(botId: string, input: NewBotInput): Promise<void> {
  const bot = getBot(botId);
  if (!bot) throw botNotFound();
  const before = bot.brain;
  const after = input.brain;
  const continues =
    (before.kind === "xai" && after.kind === "xai") ||
    // An agent thread lives in its project with its agent, model and presentation.
    (sameBrain(before, after) && bot.projectId === input.projectId);
  if (!continues) {
    if (useBotChatPanelStore.getState().openBotId === botId) closeBotChatPanel();
    if (before.kind === "xai") await forgetBotApiChat(bot.chatId);
    useBotsStore.getState().setBotChatId(botId, undefined);
  }
  useBotsStore.getState().updateBot(botId, {
    label: input.label,
    brain: input.brain,
    projectId: input.projectId,
    avatar: input.avatar,
    instructions: input.instructions ?? "",
    memory: input.memory ?? "",
  });
}

/** Removes the bot and its API chat; an agent bot's thread stays (it is the host's). */
export async function removeBot(botId: string): Promise<void> {
  const bot = getBot(botId);
  if (!bot) return;
  if (useBotChatPanelStore.getState().openBotId === botId) closeBotChatPanel();
  if (bot.brain.kind === "xai") await forgetBotApiChat(bot.chatId);
  useBotsStore.getState().deleteBot(botId);
}

/** The group chat's display title: the bots' names. */
export function botGroupChatTitle(names: readonly string[]): string {
  const list = names.join(", ");
  return i18n._(msg`Group chat: ${list}`);
}

export async function startGroupChat(
  botIds: readonly string[],
  projectId: string,
  title?: string,
): Promise<string> {
  await whenBotsHydrated();
  const uniqueIds = [...new Set(botIds)];
  const bots = uniqueIds.map((id) => getBot(id));
  if (bots.some((bot) => bot === undefined)) throw botNotFound();
  const seated = bots.filter((bot) => bot !== undefined);
  if (seated.length < BOT_GROUP_CHAT_MIN_BOTS || seated.length > BOT_GROUP_CHAT_MAX_BOTS) {
    throw new Error(i18n._(msg`A group chat needs 2 to 5 bots.`));
  }
  const names = seated.map((bot) => bot.label);
  const sessionId = await startRoundtable({
    title: title?.trim() || botGroupChatTitle(names),
    task: `Open group chat between ${names.join(", ")}. The user @mentions who should reply; stay in your own role and keep replies short.`,
    pattern: "open",
    projectId,
    participants: seated.map(botToParticipant),
  });
  // Never switch the view by itself: the group chat's Roundtable tab appears
  // in the background (and it is listed in the Bots sidebar).
  openRoundtableTab(sessionId);
  return sessionId;
}
