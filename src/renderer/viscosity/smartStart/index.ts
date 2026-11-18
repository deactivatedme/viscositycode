/**
 * ViscosityCode: Smart start ("Let ViscosityCode pick") public surface (fork of Poracode).
 *
 * - `useSmartStartDraft`: the new-thread composer hook (Auto toggle, pick row,
 *   hand-picked provider memory).
 * - `SmartStartPreferencesEditor`: the "preferred for coding / quick
 *   questions" lists, mountable in Settings.
 */
export {
  useSmartStartDraft,
  type SmartStartDraft,
  type SmartStartDraftInput,
} from "./useSmartStartDraft";
export { SmartStartPreferencesDialog, SmartStartPreferencesEditor } from "./SmartStartPreferences";
export { useSmartStartStore } from "./smartStartStore";
