import type { AgentStatus, Project } from "@/shared/contracts";
import { getCodeShareSubscriptionProvider } from "@/shared/codeShareSubscriptionProviders";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { runAgentLoginCommand } from "@/renderer/actions/agentLoginActions";
import { refreshHostAgentAuthStatus } from "@/renderer/actions/hostAgentAuthActions";
import { isRemoteSession } from "@/renderer/bridge";
import {
  readHostAgentStatusPools,
  selectLocationAgentStatuses,
} from "@/renderer/hooks/useHostAgentStatuses";
import { useAppStore } from "@/renderer/state/appStore";
import { selectBrowserBridgeClientServer } from "@/renderer/state/remoteServers/browserBridge";
import { remoteConnectionKey } from "@/renderer/state/remoteServers/types";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { isLocalDesktopWindow, servesThisPage } from "@/renderer/viscosity/localDesktopWindow";
import { findTerminalAuthMethodForStatus } from "@/renderer/utils/acpRegistryAuth";
import { CodeShareClientError } from "./client";

export function usesGuestSubscription(
  status: Pick<AgentStatus, "kind" | "authState" | "providerMetadata">,
): boolean {
  return (
    status.authState === "authenticated" &&
    getCodeShareSubscriptionProvider(status.kind)?.acceptsAccount(status.providerMetadata) === true
  );
}

export function canRunCodeShareSubscription(): boolean {
  try {
    if (!isRemoteSession()) return true;
    if (!isLocalDesktopWindow()) return false;
    const bound = selectBrowserBridgeClientServer(useRemoteServersStore.getState());
    return !!bound && servesThisPage(bound.endpoint);
  } catch {
    return false;
  }
}

function localProject(): Project {
  if (!canRunCodeShareSubscription()) throw new CodeShareClientError("desktop_required");
  let localHost: string | undefined;
  if (isRemoteSession()) {
    if (!isLocalDesktopWindow()) throw new CodeShareClientError("desktop_required");
    const bound = selectBrowserBridgeClientServer(useRemoteServersStore.getState());
    if (!bound || !servesThisPage(bound.endpoint))
      throw new CodeShareClientError("desktop_required");
    localHost = remoteConnectionKey(bound);
  }
  const id = getCurrentProjectId();
  const projects = useAppStore.getState().projects.filter((project) => {
    const host = project.remoteServerId ?? project.location.remoteServerId;
    return host === undefined || host === localHost;
  });
  const project = projects.find((entry) => entry.id === id) ?? projects[0];
  if (!project) throw new CodeShareClientError("local_project_required");
  return project;
}

function localAgent(provider: string, project: Project): AgentStatus | undefined {
  return selectLocationAgentStatuses(
    readHostAgentStatusPools(project.remoteServerId),
    project.location,
  ).find((status) => status.kind === provider && status.installed);
}

export function openCodeShareSubscriptionSignIn(provider: string): void {
  const kind = getCodeShareSubscriptionProvider(provider)?.id;
  if (!kind) throw new CodeShareClientError("model_unavailable");
  const project = localProject();
  const status = localAgent(kind, project);
  if (!status?.loginCommand) {
    usePanelStore.getState().openSettingsSection(`agents:${kind}`);
    return;
  }
  const method = findTerminalAuthMethodForStatus(status);
  const started = runAgentLoginCommand({
    project,
    label: status.label,
    status,
    command: status.loginCommand,
    ...(method?.env ? { env: method.env } : {}),
  });
  if (!started) throw new CodeShareClientError("subscription_sign_in");
}

export async function prepareCodeShareSubscriptionLaunch(
  provider: string,
  model: string,
  prompt: string,
  threadId: string,
): Promise<() => Promise<boolean>> {
  const kind = getCodeShareSubscriptionProvider(provider)?.id;
  if (!kind) throw new CodeShareClientError("model_unavailable");
  const project = localProject();
  const prior = localAgent(kind, project);
  if (!prior) throw new CodeShareClientError("subscription_sign_in");
  const status = await refreshHostAgentAuthStatus(prior, undefined);
  if (!status || !usesGuestSubscription(status))
    throw new CodeShareClientError("subscription_sign_in");
  if (!status.capabilities.models.some((entry) => entry.id === model))
    throw new CodeShareClientError("model_unavailable");
  return async () => {
    if (!canRunCodeShareSubscription()) throw new CodeShareClientError("desktop_required");
    const { startThreadFromDraft } = await import("@/renderer/actions/threadLaunchActions");
    return (
      (await startThreadFromDraft(
        project,
        {
          threadId,
          agentKind: kind,
          config: { model },
          prompt,
          presentationMode: "gui",
        },
        { preserveActiveGroup: false },
      )) === "accepted"
    );
  };
}
