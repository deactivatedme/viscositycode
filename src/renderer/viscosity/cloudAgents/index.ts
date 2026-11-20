/**
 * ViscosityCode Cloud agents feature entry (fork of Poracode).
 *
 * Importing this module once at startup registers Mission Control's Cloud tab
 * and the "Open Cloud agents" palette command. The tab's panel loads lazily
 * when it first opens.
 */
import { registerCloudAgents } from "./registerCloudAgents";

registerCloudAgents();

export { CLOUD_AGENTS_TAB_ID, openCloudAgents } from "./openCloudAgents";
export { registerCloudAgentSetupHint, type CloudAgentSetupHint } from "./cloudSetupHints";
