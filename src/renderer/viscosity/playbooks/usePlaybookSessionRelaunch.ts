/**
 * ViscosityCode: restart an idle chat whose playbook changed the MCP servers
 * its running session was launched with, the way `useCrewSessionRelaunch` does
 * for crew helpers. Custom and host servers (live_re) are fixed at launch for
 * every GUI scope but "none", so this covers "always" providers too; only the
 * built-in browser is rebuilt per turn under "always". The next send resumes
 * the session with the new server set. Never while any work or request is
 * pending, and once per chat, playbook and server change.
 */
import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import type { AgentCapability, Thread, ThreadConfig } from "@/shared/contracts";
import { resolveComposerMcpScope } from "@/shared/contracts/agent";
import { playbookFingerprint, threadPlaybookBinding } from "@/shared/viscosity/playbook";
import { unloadStoredThread } from "@/renderer/actions/threadActions";
import { PLAYBOOK_BROWSER_ID } from "./applyPlaybook";

export function usePlaybookSessionRelaunch(input: {
  thread: Thread;
  capabilities: AgentCapability | undefined;
  runtimeLaunchConfig: ThreadConfig | undefined;
  pendingSteer: unknown;
  queuedFollowUp: unknown;
  openRuntimeRequest: boolean;
  activeSubAgent: boolean;
}): string | undefined {
  const { t } = useLingui();
  const requested = useRef(new Set<string>());
  const binding = threadPlaybookBinding(input.thread.config);
  const launched = input.runtimeLaunchConfig?.mcpServerOverrides;
  const current = input.thread.config.mcpServerOverrides;
  const scope = input.capabilities
    ? resolveComposerMcpScope(input.capabilities.mcpScope, "gui")
    : "none";
  const missingIds =
    scope === "none"
      ? []
      : (binding?.mcpServerIds ?? []).filter(
          (id) => id !== PLAYBOOK_BROWSER_ID && launched?.[id] !== true,
        );
  // Servers the session launched with that a playbook switch turned off (only
  // playbooks change these overrides once a chat runs).
  const staleIds =
    scope === "none"
      ? []
      : Object.keys(launched ?? {}).filter(
          (id) => launched?.[id] === true && current?.[id] !== true,
        );
  // Under "launch" the built-in browser is fixed too: a playbook turned it on,
  // or (leaving Web QA) explicitly off, mid-chat.
  const browserNow = input.thread.config.browserMcp;
  const browserLaunched = input.runtimeLaunchConfig?.browserMcp === true;
  if (
    scope === "launch" &&
    ((binding !== undefined && browserNow === true && !browserLaunched) ||
      (browserNow === false && browserLaunched))
  ) {
    missingIds.push("browser");
  }
  const changes = [...missingIds, ...staleIds.map((id) => `-${id}`)];
  const key = `${input.thread.id}:${playbookFingerprint(binding)}:${changes.join(",")}`;
  const relaunchCondition =
    changes.length > 0 &&
    input.thread.presentationMode === "gui" &&
    input.thread.status === "idle" &&
    input.runtimeLaunchConfig !== undefined &&
    input.pendingSteer == null &&
    input.queuedFollowUp == null &&
    !input.openRuntimeRequest &&
    !input.activeSubAgent;
  const shouldRelaunch = relaunchCondition && input.thread.sessionRef !== undefined;

  useEffect(() => {
    if (!shouldRelaunch || requested.current.has(key)) return;
    requested.current.add(key);
    void Promise.resolve(unloadStoredThread(input.thread.id, { keepSidePanels: true })).catch(
      () => {},
    );
  }, [input.thread.id, key, shouldRelaunch]);

  return relaunchCondition && !input.thread.sessionRef
    ? t`The playbook's tools join when this chat restarts.`
    : undefined;
}
