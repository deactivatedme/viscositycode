/**
 * ViscosityCode status bar public API. Later fork steps add an item with
 * `registerStatusBarItem` and need nothing else from this folder.
 */
export {
  type StatusBarAlign,
  type StatusBarItem,
  type StatusBarItemDefinition,
  getStatusBarItems,
  registerStatusBarItem,
  subscribeStatusBarItems,
  useStatusBarItems,
} from "./statusBarRegistry";
export { ViscosityStatusBar, ViscosityStatusBarFrame } from "./ViscosityStatusBar";
export {
  type AgentStateCounts,
  getAgentStateCounts,
  selectErrorCount,
  selectWaitingCount,
  selectWorkingCount,
} from "./agentCounts";
