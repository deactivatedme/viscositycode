// ViscosityCode: host-owned account-pool failover (fork of Poracode).
export {
  AccountPoolFailoverService,
  type AccountFailoverOutcome,
  type AccountPoolFailoverDeps,
} from "./AccountPoolFailoverService";
export type { AccountPoolNotice, AccountPoolNoticeKind } from "./accountPoolNotices";
export {
  createHostAccountPoolFailover,
  type HostAccountPoolFailoverInputs,
} from "./hostAccountPoolFailover";
export {
  readAccountPoolsSetting,
  resolveAccountPool,
  sharesEnabledAccountPool,
  USAGE_LIMITED_ERROR_REASON,
} from "./failoverPolicy";
