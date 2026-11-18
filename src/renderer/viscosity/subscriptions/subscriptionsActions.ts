/**
 * ViscosityCode: Subscriptions dashboard actions (fork of Poracode).
 *
 * Every action reuses an existing app path: the usage panel's forced usage
 * refresh, the agent settings' terminal sign-in (`runAgentLoginCommand`) and
 * the Settings deep link to a provider's agent page, where its profiles and
 * account pool live.
 */
import type { AgentStatus } from "@/shared/contracts";
import { runAgentLoginCommand } from "@/renderer/actions/agentLoginActions";
import { refreshHostAgentAuthStatus } from "@/renderer/actions/hostAgentAuthActions";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { refreshAndMergeProviderUsage } from "@/renderer/components/providers/refreshProviderUsageSnapshot";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { findTerminalAuthMethodForStatus } from "@/renderer/utils/acpRegistryAuth";

/**
 * Force a live usage collection of every tracked account (the usage panel's
 * refresh) and merge the replies so the dashboard updates without waiting for
 * the broadcast. Failures surface as each provider's own error snapshot.
 */
export async function refreshSubscriptionsUsage(): Promise<void> {
  try {
    const response = await readBridge().refreshProviderUsage({ force: true });
    const store = useProviderUsageStore.getState();
    for (const snapshot of response.snapshots) store.mergeSnapshot(snapshot);
  } catch {
    // The supervisor broadcasts per-provider error snapshots; nothing to add here.
  }
}

/** Settings → Agents → this provider's page (profiles and the account pool card). */
export function openProviderAgentSettings(agentKind: string): void {
  usePanelStore.getState().openSettingsSection(`agents:${agentKind}`);
}

/**
 * True on a desktop client. A browser client has no desktop sign-in surface
 * (matching the thread sign-in dock); an unknown runtime offers nothing.
 */
export function canOpenLocalAgentSettings(): boolean {
  try {
    return !isRemoteSession();
  } catch {
    return false;
  }
}

/** The terminal sign-in can run here: a login command and the desktop's terminal overlay. */
export function canStartTerminalSignIn(status: AgentStatus | undefined): status is AgentStatus & {
  loginCommand: string;
} {
  return Boolean(status?.loginCommand) && canOpenLocalAgentSettings();
}

/**
 * Run the provider's own login command in the sign-in terminal overlay, then
 * re-read that account's sign-in state and usage. Returns false when the
 * overlay could not open (for example, no project to run it in yet).
 */
export function startAccountSignIn(
  status: AgentStatus,
  usageId: string,
  onSettled?: () => void,
): boolean {
  if (!canStartTerminalSignIn(status)) return false;
  const method = findTerminalAuthMethodForStatus(status);
  const opened = runAgentLoginCommand({
    label: status.label,
    status,
    command: status.loginCommand,
    ...(method?.env ? { env: method.env } : {}),
    onCommandComplete: (exitCode) => {
      onSettled?.();
      void refreshHostAgentAuthStatus(status, undefined).catch(() => undefined);
      if (exitCode === 0) void refreshAndMergeProviderUsage(usageId);
    },
  });
  if (!opened) onSettled?.();
  return opened;
}
