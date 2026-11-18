/**
 * ViscosityCode: composes the account-pool failover service for a host data
 * owner. `BackendDurableServices` calls this for both the desktop backend and
 * the standalone (headless) server, so both hosts run the same policy over the
 * same durable rows and supervisor; only the injected client effects differ
 * (a desktop renderer mirror and OS notifications exist only on desktop).
 */
import { resolveMcpLaunchSnapshot, type RemoteThreadCommand } from "@/shared/contracts";
import { normalizeAccountPools } from "@/shared/accountPools";
import type { SharedSettings } from "@/shared/settings";
import { usageAccountIdForAgent } from "@/shared/usageAccountId";
import { dbGetProject, dbGetThread } from "@/host/db";
import { assertRemoteThreadStartExperimentSafe } from "@/host/remote/experimentOwnership";
import { applyThreadSwitch } from "@/host/remote/server/threadSwitch";
import type { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import type { AccountPoolNotice } from "./accountPoolNotices";
import {
  AccountPoolFailoverService,
  type AccountFailoverOutcome,
  type AccountPoolFailoverDeps,
} from "./AccountPoolFailoverService";
import { readAccountPoolsSetting } from "./failoverPolicy";

export interface HostAccountPoolFailoverInputs {
  supervisor: Pick<SupervisorClient, "call">;
  getSharedSettings(): SharedSettings;
  /** Desktop renderer mirror of the switch; a renderer-less host returns false. */
  dispatchThreadCommand(command: RemoteThreadCommand): unknown;
  publishThreadsChanged(threadIds: readonly string[]): void;
  notifyUser(input: { title: string; body: string; threadId: string }): unknown;
  /** Owners that must not settle a thread's work while its failover is pending. */
  failoverObserver?: {
    holdForAccountFailover(threadId: string): void;
    releaseAccountFailover(threadId: string, outcome: AccountFailoverOutcome): void;
  };
  reportError?(error: unknown): void;
  /** Test seam: overrides individual dependencies. */
  overrides?: Partial<AccountPoolFailoverDeps>;
}

export function createHostAccountPoolFailover(
  inputs: HostAccountPoolFailoverInputs,
): AccountPoolFailoverService {
  const { supervisor, failoverObserver, reportError } = inputs;
  const publishNotice = (notice: AccountPoolNotice): void => {
    // Host notices honour the owner's notification switch; the handoff divider
    // in the transcript is always written by the supervisor regardless.
    if (inputs.getSharedSettings().notificationsEnabled === false) return;
    void Promise.resolve(
      inputs.notifyUser({ title: notice.title, body: notice.body, threadId: notice.threadId }),
    ).catch((error: unknown) => reportError?.(error));
  };
  return new AccountPoolFailoverService({
    getAccountPools: () => {
      const settings = inputs.getSharedSettings();
      // Members whose profile was removed (or that belong to another driver) never take work over.
      return normalizeAccountPools(readAccountPoolsSetting(settings), settings.agentInstances);
    },
    getDisabledAgents: () => inputs.getSharedSettings().disabledAgents ?? [],
    // Profiles that share one login share one meter, so they share one quota.
    usageIdFor: (agentKind) =>
      usageAccountIdForAgent(agentKind, undefined, inputs.getSharedSettings().agentInstances),
    getThread: dbGetThread,
    getProject: dbGetProject,
    getAgentStatuses: (wslDistros) => supervisor.call("getAgentStatuses", { wslDistros }),
    getUsageSnapshots: async (usageIds) =>
      (await supervisor.call("getProviderUsage", { providerIds: [...usageIds] })).snapshots,
    resolveMcpLaunchSnapshot: (project, overrides) =>
      resolveMcpLaunchSnapshot(inputs.getSharedSettings(), project, overrides),
    switchThread: (payload) =>
      applyThreadSwitch(
        {
          dispatchThreadCommand: (command) => inputs.dispatchThreadCommand(command),
          startThread: (startPayload) => supervisor.call("startThread", startPayload),
          publishThreadsChanged: (threadIds) => inputs.publishThreadsChanged(threadIds),
        },
        payload,
      ),
    canSwitchThread: (threadId) => {
      try {
        assertRemoteThreadStartExperimentSafe(threadId);
        return true;
      } catch {
        return false;
      }
    },
    publishNotice,
    ...(failoverObserver
      ? {
          onFailoverPending: (threadId: string) =>
            failoverObserver.holdForAccountFailover(threadId),
          onFailoverSettled: (threadId: string, outcome: AccountFailoverOutcome) =>
            failoverObserver.releaseAccountFailover(threadId, outcome),
        }
      : {}),
    ...(reportError ? { reportError } : {}),
    ...inputs.overrides,
  });
}
