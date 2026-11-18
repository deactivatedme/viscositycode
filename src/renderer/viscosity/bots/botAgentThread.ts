/**
 * ViscosityCode: an agent bot's one ongoing thread (fork of Poracode).
 *
 * Created once, through the same renderer actions the PR Ask side chat uses
 * (`createThread` without focus → `performInitialThreadLaunch`), so the host
 * creates the row and the supervisor — never this renderer — starts the
 * agent. The thread is an ordinary project thread titled with the bot's name:
 * it shows in the sidebar, keeps its transcript on the host, and approvals and
 * questions reach the user as for any thread.
 *
 * The provider's default mode, approval and sandbox settings are kept (only
 * model selection fields are resolved), matching PR Ask: a bot's standing
 * instructions are user text, never a reason to raise permissions.
 */
import { msg } from "@lingui/core/macro";
import { DEFAULT_TERMINAL_SIZE, type AgentStatus, type Project } from "@/shared/contracts";
import { authStateForPresentation } from "@/shared/agentSelection";
import { friendlyError } from "@/shared/messages";
import { resolveProjectLocation } from "@/shared/worktree";
import { isRemoteCommandOutcomeUncertainError } from "@/renderer/actions/threadCommandOutcomeActions";
import {
  markThreadLaunchFailed,
  performInitialThreadLaunch,
} from "@/renderer/actions/threadLaunchActions";
import {
  agentWithCapabilities,
  launchSelectionFields,
  resolveProviderDraftConfig,
  resolveSavedProviderDraftConfig,
} from "@/renderer/components/thread/threadDraftViewHelpers";
import {
  readHostAgentStatusPools,
  selectLocationAgentStatuses,
} from "@/renderer/hooks/useHostAgentStatuses";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { entityHost } from "@/renderer/state/entityHost";
import { remoteOwner } from "@/renderer/state/remoteProjection";
import { isRemoteProjectStatusUnreachable } from "@/renderer/state/remoteServers/reachability";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { ParticipantBrain } from "../roundtable/types";
import type { BotProfile } from "./api";
import { buildAgentBotPreamble } from "./botPrompts";
import { useBotsStore } from "./botStore";

type AgentBrain = Extract<ParticipantBrain, { kind: "agent" }>;

export type BotLaunchErrorCode =
  | "project-missing"
  | "project-unreachable"
  | "agent-unavailable"
  | "launch-failed";

export class BotLaunchError extends Error {
  readonly code: BotLaunchErrorCode;
  /** The launch may have reached the host: never resend it automatically. */
  readonly uncertain: boolean;
  constructor(code: BotLaunchErrorCode, message: string, uncertain = false) {
    super(message);
    this.name = "BotLaunchError";
    this.code = code;
    this.uncertain = uncertain;
  }
}

function findProject(projectId: string): Project | undefined {
  return useAppStore.getState().projects.find((project) => project.id === projectId);
}

/** The bot's thread when it still exists (deleted or archived threads start over). */
export function liveBotThreadId(bot: BotProfile): string | undefined {
  if (!bot.chatId || bot.brain.kind !== "agent") return undefined;
  const thread = useAppStore.getState().threads.find((row) => row.id === bot.chatId);
  return thread && !thread.archived ? thread.id : undefined;
}

/**
 * The agent the brain names, if it can start a thread in this presentation
 * right now (same readiness rule as PR Ask and the Roundtable engine).
 */
function readyAgentFor(project: Project, brain: AgentBrain): AgentStatus | undefined {
  const statuses = selectLocationAgentStatuses(
    readHostAgentStatusPools(remoteOwner(project)?.desktopId),
    project.location,
  );
  const status = statuses.find((candidate) => candidate.kind === brain.agentKind);
  if (!status?.installed) return undefined;
  if (useSharedSettings.getState().disabledAgents.includes(status.kind)) return undefined;
  const modes = status.capabilities.presentationModes ?? [status.capabilities.presentationMode];
  if (!modes.includes(brain.presentationMode)) return undefined;
  if (authStateForPresentation(status, brain.presentationMode) === "missing") return undefined;
  const agent = agentWithCapabilities(status, brain.presentationMode);
  return agent.capabilities.models.length > 0 ? agent : undefined;
}

function threadConfigFor(project: Project, agent: AgentStatus, brain: AgentBrain) {
  const settings = useSharedSettings.getState();
  const saved = resolveSavedProviderDraftConfig(
    agent.kind,
    project.lastDraftConfig,
    settings.providerConfigs,
    settings.providerModelPreferences,
    agent.capabilities,
  );
  // The bot's model wins; effort/context/fast follow the user's saved choices for it.
  const draft = resolveProviderDraftConfig(agent, { ...saved, model: brain.model });
  return launchSelectionFields(draft, agent.capabilities);
}

const inFlight = new Map<string, Promise<string>>();

/**
 * The bot's ongoing thread id: the existing one, or a new thread launched
 * with the bot's preamble. `onCreated` runs as soon as the row exists, before
 * the launch finishes, so the caller can show it. Concurrent calls share one
 * launch.
 */
export function ensureAgentBotThread(
  bot: BotProfile,
  onCreated?: (threadId: string) => void,
): Promise<string> {
  const existing = liveBotThreadId(bot);
  if (existing) return Promise.resolve(existing);
  const pending = inFlight.get(bot.id);
  if (pending) return pending;
  const launch = launchAgentBotThread(bot, onCreated).finally(() => {
    inFlight.delete(bot.id);
  });
  inFlight.set(bot.id, launch);
  return launch;
}

async function launchAgentBotThread(
  bot: BotProfile,
  onCreated?: (threadId: string) => void,
): Promise<string> {
  const brain = bot.brain;
  if (brain.kind !== "agent") {
    throw new BotLaunchError("agent-unavailable", i18n._(msg`This bot does not use an agent.`));
  }
  const project = findProject(bot.projectId);
  if (!project) {
    throw new BotLaunchError(
      "project-missing",
      i18n._(msg`The bot's workspace project is no longer available. Pick another one.`),
    );
  }
  const serverStatus = project.remoteServerId
    ? useRemoteServersStore.getState().runtime[project.remoteServerId]?.status
    : undefined;
  if (isRemoteProjectStatusUnreachable(project, serverStatus)) {
    throw new BotLaunchError(
      "project-unreachable",
      i18n._(msg`The bot's workspace is on a machine that is offline right now.`),
    );
  }
  const agent = readyAgentFor(project, brain);
  if (!agent) {
    throw new BotLaunchError(
      "agent-unavailable",
      i18n._(msg`The bot's agent is not installed, enabled and signed in. Choose another brain.`),
    );
  }
  const config = threadConfigFor(project, agent, brain);
  const prompt = buildAgentBotPreamble(bot);
  const store = useAppStore.getState();
  // A new row carries its project host's identity, whichever host that is.
  const identity = entityHost(project)?.projectThreadRow(crypto.randomUUID()) ?? {
    threadId: crypto.randomUUID(),
  };
  const thread = store.createThread({
    ...identity,
    projectId: project.id,
    agentKind: agent.kind,
    ...(brain.agentInstanceId ? { agentInstanceId: brain.agentInstanceId } : {}),
    config,
    prompt,
    title: bot.label,
    presentationMode: brain.presentationMode,
    // Never steal the view: the caller decides whether to show the thread.
    focus: false,
  });
  // Remember the thread before the launch resolves, so a second open reuses it.
  useBotsStore.getState().setBotChatId(bot.id, thread.id);
  onCreated?.(thread.id);
  try {
    await performInitialThreadLaunch({
      thread,
      projectLocation: resolveProjectLocation(project.location, thread.worktreePath),
      prompt,
      initialSize: DEFAULT_TERMINAL_SIZE,
    });
    return thread.id;
  } catch (error) {
    const uncertain = isRemoteCommandOutcomeUncertainError(error);
    if (!uncertain && useAppStore.getState().threads.some((row) => row.id === thread.id)) {
      markThreadLaunchFailed(thread.id, error);
    }
    throw new BotLaunchError("launch-failed", friendlyError(error), uncertain);
  }
}
