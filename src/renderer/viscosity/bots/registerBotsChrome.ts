/**
 * ViscosityCode Bots: the activity bar item and its sidebar view (fork of
 * Poracode). The activity bar only renders in the desktop shell, and the item
 * also hides itself outside it.
 */
import { msg } from "@lingui/core/macro";
import { lazy } from "react";
import { BotMessageSquare } from "lucide-react";
import { registerActivityBarItem } from "@/renderer/viscosity/layout/activityBar/activityBarRegistry";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import { useBotsAttentionCount } from "./ui/botLiveState";

export const BOTS_ACTIVITY_ITEM_ID = "bots";
/** After Agents (100), before Roundtable (160) and Explorer (200). */
export const BOTS_ACTIVITY_ITEM_ORDER = 150;

const loadSidebarView = () =>
  import("./ui/BotsSidebarView").then((module) => ({ default: module.BotsSidebarView }));

const BotsSidebarView = lazy(loadSidebarView);

function preloadSidebarView(): void {
  void loadSidebarView();
}

let registered = false;

/** Idempotent: registers the Bots activity bar item once per renderer. */
export function registerBotsChrome(): void {
  if (registered) return;
  registered = true;
  registerActivityBarItem({
    id: BOTS_ACTIVITY_ITEM_ID,
    label: msg`Bots`,
    icon: BotMessageSquare,
    order: BOTS_ACTIVITY_ITEM_ORDER,
    view: BotsSidebarView,
    onPreload: preloadSidebarView,
    // Bots waiting for an approval or an answer: the user still decides.
    useBadge: useBotsAttentionCount,
    useIsAvailable: useViscosityShellEnabled,
  });
}
