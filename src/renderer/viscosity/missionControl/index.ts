/**
 * ViscosityCode Mission Control feature entry (fork of Poracode).
 *
 * Importing this module registers Mission Control's chrome once (the
 * built-in "Agents" tab, the activity bar item, the "N need you" status bar
 * item and the "Open Mission Control" palette command) and exposes the
 * center host. Mount `MissionControlHost` inside the center frame's body
 * next to the Roundtable and bot hosts. Other features add tabs through
 * `./tabs` and open the panel through `openMissionControl`. The Subscriptions
 * feature is imported here once, so its tab and command register at startup.
 */
import { registerMissionControl } from "./registerMissionControl";
// ViscosityCode: Subscriptions tab in Mission Control and the "Open Subscriptions" palette command (registers on import).
import "@/renderer/viscosity/subscriptions";

registerMissionControl();

export { MissionControlHost } from "./ui/MissionControlHost";
export {
  closeMissionControl,
  MISSION_AGENTS_TAB_ID,
  openMissionControl,
  toggleMissionControl,
} from "./missionControlViewStore";
