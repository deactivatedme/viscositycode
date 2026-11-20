/**
 * ViscosityCode: opening the Cloud tab (fork of Poracode). Mission Control
 * owns how it opens; this feature only asks for its tab.
 */
import { openMissionControl } from "@/renderer/viscosity/missionControl/missionControlViewStore";

export const CLOUD_AGENTS_TAB_ID = "cloud";

/** Show Mission Control on the Cloud tab. */
export function openCloudAgents(): void {
  openMissionControl({ tabId: CLOUD_AGENTS_TAB_ID });
}
