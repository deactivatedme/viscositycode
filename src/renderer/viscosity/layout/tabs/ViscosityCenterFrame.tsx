import type { ReactNode } from "react";
// ViscosityCode: Roundtable center panel (registers its activity/status bar items on import).
import { RoundtableCenterHost } from "@/renderer/viscosity/roundtable";
// ViscosityCode: Grok bot chat panel and bot dialogs (registers the Bots activity item on import).
import { BotChatPanelHost } from "@/renderer/viscosity/bots";
import { useViscosityShellEnabled } from "./shellGate";
import { ViscosityTabStrip } from "./ViscosityTabStrip";

/**
 * Center column of the main window: the open-thread tab strip above upstream's
 * content (split panes, file editor panel). Outside the fork's desktop shell
 * (phone/PWA layout, extension side panel, other windows) it renders the
 * content unchanged.
 */
export function ViscosityCenterFrame(props: { children: ReactNode }) {
  const enabled = useViscosityShellEnabled();
  if (!enabled) return props.children;
  return (
    <div data-vc-center="" className="flex h-full min-h-0 flex-col">
      <ViscosityTabStrip />
      <div data-vc-center-body="" className="relative min-h-0 flex-1">
        {props.children}
        {/* ViscosityCode: the open Roundtable over the split view, and its setup dialog. */}
        <RoundtableCenterHost />
        {/* ViscosityCode: an open Grok bot chat over the split view, and the bot dialogs. */}
        <BotChatPanelHost />
      </div>
    </div>
  );
}
