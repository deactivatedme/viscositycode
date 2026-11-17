/**
 * ViscosityCode open-thread tab strip public API.
 */
export { ViscosityCenterFrame } from "./ViscosityCenterFrame";
export { useViscosityShellEnabled } from "./shellGate";
export {
  activateThreadTab,
  closeThreadTab,
  hideEditorPanel,
  openNewThreadTab,
  showThreadInFocusedPane,
  toggleEditorTab,
} from "./tabActions";
export { OPEN_TABS_STORAGE_KEY } from "./openTabsModel";
export { useOpenTabsStore, useRenderableTabIds } from "./openTabsStore";
