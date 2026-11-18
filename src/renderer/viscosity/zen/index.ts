/**
 * ViscosityCode Zen mode entry (fork of Poracode).
 *
 * Importing this module registers the "Toggle Zen mode" palette command once.
 * Mount `<ZenModeHost />` once inside the desktop shell's center frame; the
 * styles live in zen.css (imported by viscosity.css).
 */
import { registerZenMode } from "./registerZenMode";

registerZenMode();

export { ZenModeHost } from "./ZenModeHost";
export { TOGGLE_ZEN_MODE_COMMAND_ID } from "./zenCommands";
export {
  enterZenMode,
  exitZenMode,
  isZenModeActive,
  toggleZenMode,
  useZenModeStore,
  ZEN_ATTRIBUTE,
} from "./zenModeStore";
