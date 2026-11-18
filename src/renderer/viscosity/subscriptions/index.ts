/**
 * ViscosityCode Subscriptions feature entry (fork of Poracode).
 *
 * Importing this module once at startup registers the Subscriptions tab in
 * Mission Control and the "Open Subscriptions" palette command. The dashboard
 * itself loads lazily when the tab first opens.
 */
import { registerSubscriptions } from "./registerSubscriptions";

registerSubscriptions();

export { openSubscriptions, SUBSCRIPTIONS_TAB_ID } from "./openSubscriptions";
