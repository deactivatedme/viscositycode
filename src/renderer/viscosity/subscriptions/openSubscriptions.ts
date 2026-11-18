/**
 * ViscosityCode: opening the Subscriptions tab (fork of Poracode).
 *
 * Mission Control owns how it opens (desktop shell only, stepping in front of
 * the editor, a Roundtable or a bot chat) and which tab it shows; this feature
 * only asks it to show the Subscriptions tab. User actions only.
 */
import { openMissionControl } from "@/renderer/viscosity/missionControl/missionControlViewStore";

export const SUBSCRIPTIONS_TAB_ID = "subscriptions";

/** Show Mission Control on the Subscriptions tab. */
export function openSubscriptions(): void {
  openMissionControl({ tabId: SUBSCRIPTIONS_TAB_ID });
}
