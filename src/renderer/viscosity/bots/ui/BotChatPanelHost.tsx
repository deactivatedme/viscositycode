/**
 * ViscosityCode Bots UI: center-column host for an API bot's chat panel and
 * the bot dialogs (fork of Poracode). Mount it once inside the center frame's
 * body (`[data-vc-center-body]`, a positioned box): the panel covers the split
 * view while a Grok bot chat is open. Desktop shell only; elsewhere it renders
 * nothing and bot chats say they need the desktop layout.
 */
import { useEffect } from "react";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import { startBotChatPanelSync, useBotChatPanelStore } from "../botChatPanelStore";
import { BotChatPanel } from "./BotChatPanel";
import { BotsDialogHost } from "./BotsDialogHost";

export function BotChatPanelHost() {
  const enabled = useViscosityShellEnabled();
  const openBotId = useBotChatPanelStore((state) => state.openBotId);
  useEffect(() => (enabled ? startBotChatPanelSync() : undefined), [enabled]);
  if (!enabled) return null;
  return (
    <>
      {openBotId ? <BotChatPanel key={openBotId} botId={openBotId} /> : null}
      <BotsDialogHost />
    </>
  );
}
