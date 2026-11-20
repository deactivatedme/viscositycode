/**
 * ViscosityCode Roundtable feature entry (fork of Poracode).
 *
 * Importing this module registers the Roundtable chrome once (activity bar
 * item with its sidebar list, status bar progress item) and exposes the UI
 * entry points other features use to open a session or the setup dialog
 * (in-chat entry points). Engine calls stay in `./api` — this module
 * re-exports none of them.
 */
import { registerRoundtableChrome } from "./ui/registerRoundtableChrome";

registerRoundtableChrome();

export { RoundtableCenterHost } from "./ui/RoundtableCenterHost";
export {
  closeRoundtableSetup,
  closeRoundtableView,
  hideRoundtablePanel,
  openRoundtableSetup,
  openRoundtableTab,
  openRoundtableView,
  type RoundtableSetupRequest,
  showRoundtablePanel,
  useRoundtableViewStore,
} from "./ui/roundtableViewStore";
