/**
 * ViscosityCode Roundtable engine: the live {@link ThreadEnginePort}.
 *
 * Every call goes through an existing renderer action or store read (see
 * tmp/roundtable-research.md §1–3), copying the PR Ask side chat:
 * `createThread({focus:false})` + `performInitialThreadLaunch` for the first
 * turn, `submitThreadInput` for follow-ups, `readBridge().interruptThread` to
 * stop, `retainRuntimeThreadReader` while a turn runs. Nothing here spawns a
 * process: the supervisor does, as for every thread. Threads are created
 * without focus, so a Roundtable never switches the user's view.
 */
import { msg } from "@lingui/core/macro";
import { stripAnsiPreservingLayout } from "@/shared/ansi";
import { assistantDisplayText } from "@/shared/assistantMessageText";
import {
  DEFAULT_TERMINAL_SIZE,
  mergeMcpServers,
  type AgentStatus,
  type Project,
} from "@/shared/contracts";
import type { PersistedRuntimeItem } from "@/shared/ipc/schemas";
import { friendlyError } from "@/shared/messages";
import { readThreadToolEnabled } from "@/shared/providerHandoff";
import { resolveProjectLocation } from "@/shared/worktree";
import { assistantTranscriptContent } from "@/renderer/actions/experimentResponseTranscript";
import { isRemoteCommandOutcomeUncertainError } from "@/renderer/actions/threadCommandOutcomeActions";
import {
  markThreadLaunchFailed,
  performInitialThreadLaunch,
} from "@/renderer/actions/threadLaunchActions";
import { submitThreadInput } from "@/renderer/actions/threadRuntimeActions";
import { readBridge } from "@/renderer/bridge";
import {
  readHostAgentStatusPools,
  selectLocationAgentStatuses,
} from "@/renderer/hooks/useHostAgentStatuses";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { entityHost } from "@/renderer/state/entityHost";
import { remoteOwner } from "@/renderer/state/remoteProjection";
import { retainRuntimeThreadReader } from "@/renderer/state/runtimeInterestHydration";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { selectThreadHasActiveNativeSubAgent } from "@/renderer/state/subAgentSelectors";
import { useThreadLiveWorkflowStore } from "@/renderer/state/threadLiveWorkflowStore";
import { resolveSeatPlaybook } from "../playbooks";
import type { ParticipantProfile, RoundtableSession } from "../types";
import { buildAgentThreadConfig, type SeatPlaybook } from "./agentBrains";
import { keepHead, keepTail, RESPONSE_TEXT_CAP } from "./text";
import type { LastTurnRead, ThreadEnginePort, ThreadTurnSnapshot } from "./threadPort";

const TITLE_MAX_CHARS = 100;
const HOST_PAGE_LIMIT = 200;
const HOST_MAX_PAGES = 10;

/** Background work a turn's answer waits for (servers and monitors may never end). */
function isAwaitedBackgroundTask(task: { category?: string | undefined }): boolean {
  return task.category === "agent" || task.category === "workflow";
}

export function findProjectAgentStatus(
  project: Project,
  agentKind: string,
): AgentStatus | undefined {
  const pools = readHostAgentStatusPools(remoteOwner(project)?.desktopId);
  return selectLocationAgentStatuses(pools, project.location).find(
    (agent) => agent.kind === agentKind,
  );
}

/** The seat's playbook (its own, else the table's), resolved now, with the project's MCP servers. */
export function seatPlaybookFor(
  project: Project,
  session: Pick<RoundtableSession, "playbookId">,
  profile: Pick<ParticipantProfile, "playbookId">,
): SeatPlaybook | undefined {
  const definition = resolveSeatPlaybook(session, profile);
  if (!definition) return undefined;
  return {
    definition,
    mcpServers: mergeMcpServers(useSharedSettings.getState().mcpServers, project.mcpServers ?? []),
  };
}

interface TurnTextAccumulator {
  texts: string[];
  errorMessage: string | undefined;
}

/** Walks one item (newest first); returns `true` at the turn's user message. */
function accumulate(
  item: { type: string; payload?: unknown; parentItemId?: string | undefined },
  text: () => string,
  into: TurnTextAccumulator,
): boolean {
  if (item.parentItemId) return false;
  if (item.type === "user_message") return true;
  if (item.type === "assistant_message") {
    const value = text();
    if (value.trim()) into.texts.unshift(value);
  } else if (item.type === "error" && into.errorMessage === undefined) {
    const payload = item.payload as { message?: unknown; severity?: unknown } | undefined;
    if (payload?.severity !== "warning" && typeof payload?.message === "string") {
      into.errorMessage = payload.message;
    }
  }
  return false;
}

function readLoadedLastTurn(
  threadId: string,
): (LastTurnRead & { reachedUser: boolean }) | undefined {
  const state = useAppStore.getState();
  const ids = state.runtimeItemIdsByThread[threadId];
  const items = state.runtimeItemsByIdByThread[threadId];
  if (!ids?.length || !items) return undefined;
  const into: TurnTextAccumulator = { texts: [], errorMessage: undefined };
  let reachedUser = false;
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const item = items[ids[index]!];
    if (!item) continue;
    if (accumulate(item, () => assistantDisplayText(item), into)) {
      reachedUser = true;
      break;
    }
  }
  return { text: into.texts.join("\n\n"), errorMessage: into.errorMessage, reachedUser };
}

/** The latest turn from the host's stored items (newest page first, stops at the user message). */
async function readHostLastTurn(threadId: string): Promise<LastTurnRead> {
  const into: TurnTextAccumulator = { texts: [], errorMessage: undefined };
  let beforePosition: number | undefined;
  for (let page = 0; page < HOST_MAX_PAGES; page += 1) {
    const result = await readBridge().dbGetThreadRuntimeItemsPage({
      threadId,
      limit: HOST_PAGE_LIMIT,
      ...(beforePosition !== undefined ? { beforePosition } : {}),
    });
    const items: readonly PersistedRuntimeItem[] = result.items;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]!;
      if (accumulate(item, () => assistantTranscriptContent(item), into)) {
        return { text: into.texts.join("\n\n"), errorMessage: into.errorMessage };
      }
    }
    if (result.nextCursor === null) break;
    beforePosition = result.nextCursor;
  }
  return { text: into.texts.join("\n\n"), errorMessage: into.errorMessage };
}

export function createLiveThreadEnginePort(): ThreadEnginePort {
  return {
    snapshot(threadId): ThreadTurnSnapshot | undefined {
      const state = useAppStore.getState();
      const thread = state.threads.find((row) => row.id === threadId);
      if (!thread) return undefined;
      const live = useThreadLiveWorkflowStore.getState().liveThreadIds.has(threadId);
      const tasks = state.runtimeBackgroundTasksByThread[threadId] ?? [];
      return {
        status: thread.status,
        presentationMode: thread.presentationMode === "gui" ? "gui" : "terminal",
        interruptedTurn: thread.interruptedTurn,
        errorMessage: thread.errorMessage,
        busyInBackground:
          live ||
          tasks.some(isAwaitedBackgroundTask) ||
          selectThreadHasActiveNativeSubAgent(state, threadId),
        mentionToolsAvailable: state.threadMentionToolsAvailableByThreadId[threadId],
      };
    },

    subscribe(threadId, listener) {
      // Narrow slices only: none of them changes on a streaming text delta.
      const unsubscribeApp = useAppStore.subscribe(
        (state) =>
          [
            state.threads,
            state.runtimeBackgroundTasksByThread[threadId],
            state.runtimeStructuralVersionByThread[threadId],
          ] as const,
        listener,
        {
          equalityFn: (left, right) =>
            left[0] === right[0] && left[1] === right[1] && left[2] === right[2],
        },
      );
      const unsubscribeLive = useThreadLiveWorkflowStore.subscribe((state, previous) => {
        if (state.liveThreadIds.has(threadId) !== previous.liveThreadIds.has(threadId)) listener();
      });
      return () => {
        unsubscribeApp();
        unsubscribeLive();
      };
    },

    readLiveText(threadId) {
      return readLoadedLastTurn(threadId)?.text ?? "";
    },

    async readLastTurn(threadId) {
      const loaded = readLoadedLastTurn(threadId);
      if (loaded?.reachedUser && loaded.text.trim()) return loaded;
      try {
        const stored = await readHostLastTurn(threadId);
        if (stored.text.trim() || !loaded) return stored;
      } catch (error) {
        console.warn("[roundtable] could not read a participant's stored answer", error);
      }
      return loaded ?? { text: "" };
    },

    async readTerminalText(threadId) {
      const raw = await readBridge().readTerminalScrollback({ threadId });
      return keepTail(stripAnsiPreservingLayout(raw).trim(), RESPONSE_TEXT_CAP);
    },

    async createAndLaunch(request, onCreated) {
      const { session, profile, brain, prompt } = request;
      const store = useAppStore.getState();
      const project = store.projects.find((item) => item.id === session.projectId);
      if (!project) throw new Error(i18n._(msg`The Roundtable's project is no longer available.`));
      const config = buildAgentThreadConfig(
        brain,
        findProjectAgentStatus(project, brain.agentKind),
        seatPlaybookFor(project, session, profile),
      );
      const hostThreadId = crypto.randomUUID();
      // A new row carries its project host's identity, whichever host that is.
      const identity = entityHost(project)?.projectThreadRow(hostThreadId) ?? {
        threadId: hostThreadId,
      };
      const label = profile.label;
      const roundtableTitle = session.title;
      const thread = store.createThread({
        ...identity,
        projectId: project.id,
        agentKind: brain.agentKind,
        ...(brain.agentInstanceId ? { agentInstanceId: brain.agentInstanceId } : {}),
        config,
        prompt,
        title: keepHead(i18n._(msg`${label} · ${roundtableTitle}`), TITLE_MAX_CHARS),
        presentationMode: brain.presentationMode,
        // Never switch the user's view: participants run in the background.
        focus: false,
        groupId: session.id,
        groupName: session.title,
        ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
        ...(session.worktreeBranch ? { worktreeBranch: session.worktreeBranch } : {}),
      });
      onCreated(thread.id);
      try {
        await performInitialThreadLaunch({
          thread,
          projectLocation: resolveProjectLocation(project.location, thread.worktreePath),
          prompt,
          ...(request.segments ? { segments: request.segments } : {}),
          ...(request.mentionHandoff ? { mentionHandoff: true as const } : {}),
          initialSize: DEFAULT_TERMINAL_SIZE,
        });
      } catch (error) {
        // An uncertain outcome may have committed: never resend; keep watching the row.
        if (isRemoteCommandOutcomeUncertainError(error)) return thread.id;
        if (useAppStore.getState().threads.some((row) => row.id === thread.id)) {
          markThreadLaunchFailed(thread.id, error);
        }
        throw error;
      }
      return thread.id;
    },

    async submit(threadId, prompt, segments) {
      const state = useAppStore.getState();
      const thread = state.threads.find((row) => row.id === threadId);
      // `submitThreadInput` returns quietly when it cannot resolve the thread or
      // its project; refuse instead of reporting a send that never happened.
      if (!thread || !state.projects.some((project) => project.id === thread.projectId)) {
        throw new Error(i18n._(msg`The participant's thread is no longer available.`));
      }
      try {
        await submitThreadInput(threadId, prompt, segments);
      } catch (error) {
        // Uncertain: the message is painted and may have been sent; never resend.
        if (isRemoteCommandOutcomeUncertainError(error)) return;
        throw error;
      }
    },

    async interrupt(threadId) {
      await readBridge().interruptThread({ threadId });
    },

    retainReader(threadId) {
      const reader = retainRuntimeThreadReader(threadId);
      return () => reader.release();
    },

    readThreadToolEnabled() {
      return readThreadToolEnabled(useSharedSettings.getState());
    },

    threadTitle(threadId) {
      return useAppStore.getState().threads.find((row) => row.id === threadId)?.title;
    },

    describeError(error) {
      return friendlyError(error);
    },
  };
}
