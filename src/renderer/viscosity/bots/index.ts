/**
 * ViscosityCode Bots feature entry (fork of Poracode).
 *
 * Importing this module registers the Bots activity bar item (sidebar view
 * with bots and group chats) once, and exposes the center host that shows a
 * Grok bot's chat panel and the bot dialogs. Mount `BotChatPanelHost` inside
 * the center frame body next to the Roundtable host. Other features call the
 * Bots API through `./api` — this module re-exports none of it.
 */
import { registerBotsChrome } from "./registerBotsChrome";

registerBotsChrome();

export { BotChatPanelHost } from "./ui/BotChatPanelHost";
export { BOTS_ACTIVITY_ITEM_ID } from "./registerBotsChrome";
