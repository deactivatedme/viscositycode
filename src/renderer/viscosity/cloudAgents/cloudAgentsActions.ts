/**
 * ViscosityCode: Cloud tab actions (fork of Poracode).
 *
 * Follow turns a cloud agent into an ordinary thread through the managed
 * host, its only writer: the host saves a Home thread row (`create`), then the
 * supervisor checks the agent with that profile's key, replays its
 * conversation and records it as the thread's resume reference
 * (`followCloudAgent`). If the second step fails the row is deleted again.
 * New cloud agent opens the normal composer with the cloud profile chosen,
 * after refusing a project whose branch is not pushed.
 */
import { toast } from "@heroui/react";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { AgentStatus, Project, Thread } from "@/shared/contracts";
import { resolveModelSelection } from "@/shared/agentSelection";
import { isHomeProject } from "@/shared/homeScope";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { openNewThread, openThread } from "@/renderer/actions/threadActions";
import { readHostAgentStatusPools } from "@/renderer/hooks/useHostAgentStatuses";
import { useAppStore } from "@/renderer/state/appStore";
import { hostHandle } from "@/renderer/state/entityHost";
import {
  cloudAgentsBridge,
  type CloudAgentSummary,
  type FollowCloudAgentResult,
} from "./cloudAgentsContract";

const TITLE_MAX_CHARS = 60;

/** The managed host's thread that already follows this agent, by exact resume reference. */
export function findFollowingThread(
  item: Pick<CloudAgentSummary, "agentKind" | "providerSessionId">,
  threads: readonly Thread[],
): Thread | undefined {
  return threads.find(
    (thread) =>
      thread.remoteServerId === undefined &&
      thread.agentKind === item.agentKind &&
      thread.sessionRef?.providerSessionId === item.providerSessionId,
  );
}

function managedAgentStatus(agentKind: string): AgentStatus | undefined {
  const pools = readHostAgentStatusPools(undefined);
  return [...pools.windows, ...pools.wsl].find((status) => status.kind === agentKind);
}

function managedHomeProject(): Project | undefined {
  return useAppStore
    .getState()
    .projects.find((project) => isHomeProject(project) && project.remoteServerId === undefined);
}

function titleFor(item: CloudAgentSummary): string {
  const name = item.name.trim() || i18n._(msg`Cloud agent`);
  return name.length > TITLE_MAX_CHARS ? `${name.slice(0, TITLE_MAX_CHARS)}…` : name;
}

/** Agents whose follow is under way, so a second press joins it instead of adding a row. */
const followsInFlight = new Map<string, Promise<string | undefined>>();

/** Follows one cloud agent; resolves to the new thread's id, or `undefined` after a reported failure. */
export function followCloudAgent(item: CloudAgentSummary): Promise<string | undefined> {
  const key = `${item.agentKind}\u0000${item.id}`;
  const running = followsInFlight.get(key);
  if (running) return running;
  const attempt = followOnHost(item).finally(() => followsInFlight.delete(key));
  followsInFlight.set(key, attempt);
  return attempt;
}

async function followOnHost(item: CloudAgentSummary): Promise<string | undefined> {
  const existing = findFollowingThread(item, useAppStore.getState().threads);
  if (existing) {
    openThread(existing.id);
    return existing.id;
  }
  const bridge = cloudAgentsBridge();
  const host = hostHandle(undefined);
  const home = managedHomeProject();
  const status = managedAgentStatus(item.agentKind);
  const model = status ? resolveModelSelection(status.capabilities) : "";
  if (!bridge || !host || !home) {
    toast.danger(i18n._(msg`Cloud agents can only be followed on this computer's own host.`));
    return undefined;
  }
  if (!model) {
    toast.danger(i18n._(msg`No model is available for this profile. Check it in Settings.`));
    return undefined;
  }
  const threadId = crypto.randomUUID();
  try {
    await host.sendThreadCommand({
      kind: "create",
      threadId,
      projectId: host.hostProjectId(home.id) ?? home.id,
      title: titleFor(item),
      agentKind: item.agentKind,
      config: { model },
      presentationMode: "gui",
    });
  } catch (error) {
    toast.danger(friendlyError(error));
    return undefined;
  }
  let result: FollowCloudAgentResult;
  try {
    result = await bridge.followCloudAgent({
      threadId,
      agentKind: item.agentKind,
      agentId: item.id,
    });
  } catch (error) {
    // Best effort: the row is empty, and the user can still delete it by hand.
    await host.sendThreadCommand({ kind: "delete", threadId }).catch(() => undefined);
    toast.danger(friendlyError(error));
    return undefined;
  }
  host.refreshCatalog();
  const viewThreadId = host.projectThreadRow(threadId).threadId;
  if (result.truncated) {
    toast.warning(i18n._(msg`Only the most recent messages of this cloud agent were copied.`));
  }
  // Until the row carries the resume reference, the list cannot see the follow (a second
  // press would add another row) and opening cannot reattach to a live run.
  await waitForSessionRef(viewThreadId, FOLLOW_SESSION_REF_WAIT_MS);
  // A finished agent only shows its history until the user sends a follow-up.
  if (result.running) openThread(viewThreadId);
  else openThread(viewThreadId, { reopenRuntime: false });
  return viewThreadId;
}

/** How long a follow waits for the host's resume reference before opening anyway. */
export const FOLLOW_SESSION_REF_WAIT_MS = 10_000;

/** Resolves once the thread row has a `sessionRef`, or after `timeoutMs`. */
export function waitForSessionRef(threadId: string, timeoutMs: number): Promise<void> {
  const ready = () =>
    useAppStore.getState().threads.some((thread) => thread.id === threadId && thread.sessionRef);
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = useAppStore.subscribe(() => {
      if (ready()) finish();
    });
  });
}

export type CloudLaunchCheck =
  | { ok: true }
  | { ok: false; reason: "no-upstream"; branch: string }
  | { ok: false; reason: "unpushed"; branch: string; ahead: number };

/**
 * A cloud agent starts from the branch on the remote, so a branch with no
 * upstream or with commits that are not pushed is refused before launch. A
 * folder that is not a git repository starts an agent with no repository.
 */
export async function checkCloudLaunchBranch(project: Project): Promise<CloudLaunchCheck> {
  if (isHomeProject(project)) return { ok: true };
  const status = await readBridge().getGitStatus({
    projectLocation: project.location,
    detail: "summary",
  });
  if (!status.isRepo) return { ok: true };
  if (!status.tracking) return { ok: false, reason: "no-upstream", branch: status.branch };
  if (status.ahead > 0) {
    return { ok: false, reason: "unpushed", branch: status.branch, ahead: status.ahead };
  }
  return { ok: true };
}

export function cloudLaunchRefusal(check: CloudLaunchCheck): string | undefined {
  if (check.ok) return undefined;
  const branch = check.branch;
  if (check.reason === "no-upstream") {
    return i18n._(
      msg`Push ${branch} to its remote first. Cloud agents start from the pushed branch.`,
    );
  }
  const ahead = check.ahead;
  return i18n._(
    msg`${branch} has ${ahead} commits that are not pushed. Push them first: cloud agents start from the pushed branch.`,
  );
}

/** The project the user is looking at, else the managed Home project. */
function currentProject(): Project | undefined {
  const projectId = getCurrentProjectId();
  const project = useAppStore.getState().projects.find((entry) => entry.id === projectId);
  return project && project.remoteServerId === undefined ? project : managedHomeProject();
}

/**
 * Opens the composer for the current project with this cloud profile chosen,
 * unless the project's branch is not pushed.
 */
export async function startNewCloudAgent(agentKind: string): Promise<void> {
  const project = currentProject();
  if (!project) {
    openNewThread();
    return;
  }
  try {
    const refusal = cloudLaunchRefusal(await checkCloudLaunchBranch(project));
    if (refusal) {
      toast.danger(refusal);
      return;
    }
  } catch (error) {
    toast.danger(friendlyError(error));
    return;
  }
  const status = managedAgentStatus(agentKind);
  const model = status ? resolveModelSelection(status.capabilities) : "";
  // The composer starts on the project's last selection; make that this profile.
  if (model) useAppStore.getState().updateProjectDraftConfig(project.id, { agentKind, model });
  openNewThread(project.id);
}
