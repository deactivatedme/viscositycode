/**
 * ViscosityCode Roundtable engine: live services around the runner — the
 * race (existing Agent Experiments: `launchExperiment` + `crownExperiment`),
 * the shared worktree of sequential patterns, and the origin thread's context.
 *
 * The user's view is never switched: launching an experiment normally opens
 * its view, so the race keeps that from happening while the launch runs. The
 * experiment's candidates are grouped panes the user can open from the
 * Roundtable or the sidebar at any time.
 */
import { msg } from "@lingui/core/macro";
import type { Project } from "@/shared/contracts";
import { sanitizeWorktreeBranchName } from "@/shared/worktree";
import { launchExperiment } from "@/renderer/actions/experimentActions";
import {
  crownExperiment,
  type ExperimentJudgeSelection,
} from "@/renderer/actions/experimentDecisionActions";
import { isEligibleExperimentJudgeAgent } from "@/renderer/actions/experimentOperationState";
import { initializeCreatedWorktree } from "@/renderer/actions/worktreeInitialization";
import { createWorktree } from "@/renderer/actions/worktreeLaunchActions";
import { readBridge } from "@/renderer/bridge";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { remoteOwner } from "@/renderer/state/remoteProjection";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import type { StartRoundtableInput } from "../api";
import type { RoundtableSession } from "../types";
import { buildAgentThreadConfig } from "./agentBrains";
import type { PlannerContext } from "./planner";
import type { RaceAdapter } from "./runner";
import type { ThreadEnginePort } from "./threadPort";
import { findProjectAgentStatus } from "./threadPortLive";

function requireProject(projectId: string): Project {
  const project = useAppStore.getState().projects.find((item) => item.id === projectId);
  if (!project) throw new Error(i18n._(msg`The Roundtable's project is no longer available.`));
  return project;
}

type OpenExperiment = AppStoreState["openExperiment"];

let backgroundLaunches = 0;
let guard: { open: OpenExperiment; original: OpenExperiment } | undefined;

/**
 * Runs `operation` (an experiment launch) without letting it switch the
 * user's view. `launchExperiment` opens its new experiment's view; while a
 * background launch runs, opening an experiment that did not exist when the
 * guard went up is skipped, so the view never changes at all (not even for a
 * moment — subscribers such as the Roundtable panel would react to that).
 * Opening an experiment that already existed (the user's sidebar click) still
 * works. Concurrent launches share one guard.
 */
export async function withoutViewSwitch<T>(operation: () => Promise<T>): Promise<T> {
  if (backgroundLaunches === 0) {
    const original = useAppStore.getState().openExperiment;
    const known = new Set(Object.keys(useExperimentStore.getState().experiments));
    const open: OpenExperiment = (experimentId, projectId) => {
      if (known.has(experimentId)) original(experimentId, projectId);
    };
    guard = { open, original };
    useAppStore.setState({ openExperiment: open });
  }
  backgroundLaunches += 1;
  try {
    return await operation();
  } finally {
    backgroundLaunches -= 1;
    if (backgroundLaunches === 0 && guard) {
      if (useAppStore.getState().openExperiment === guard.open) {
        useAppStore.setState({ openExperiment: guard.original });
      }
      guard = undefined;
    }
  }
}

export function createLiveRaceAdapter(): RaceAdapter {
  return {
    async launch(session, { prompt, participants }) {
      const project = requireProject(session.projectId);
      if (remoteOwner(project)) {
        throw new Error(
          i18n._(
            msg`A race runs on the machine hosting the project. Open the project on its host to start one.`,
          ),
        );
      }
      const branches = await readBridge().gitListBranches({
        projectLocation: project.location,
        includeRemote: false,
      });
      const baseBranch = branches.current;
      if (!baseBranch)
        throw new Error(i18n._(msg`The project has no current branch to race from.`));
      const candidates = participants.map((participant) => {
        const brain = participant.brain;
        if (brain.kind !== "agent")
          throw new Error(i18n._(msg`Every racer must be an installed agent.`));
        return {
          agentKind: brain.agentKind,
          ...(brain.agentInstanceId ? { agentInstanceId: brain.agentInstanceId } : {}),
          agentLabel: participant.label,
          config: buildAgentThreadConfig(brain, findProjectAgentStatus(project, brain.agentKind)),
          presentationMode: brain.presentationMode,
        };
      });
      const experimentId = await withoutViewSwitch(() =>
        launchExperiment({ projectId: project.id, prompt, baseBranch, candidates }),
      );
      if (!experimentId) throw new Error(i18n._(msg`The race could not start.`));
      const experiment = useExperimentStore.getState().experiments[experimentId];
      if (!experiment) throw new Error(i18n._(msg`The race could not start.`));
      // Candidates keep the order they were requested in.
      const threadIds: Record<string, string> = {};
      experiment.candidates.forEach((candidate, index) => {
        const participant = participants[index];
        if (participant) threadIds[participant.id] = candidate.threadId;
      });
      return { experimentId, threadIds };
    },

    async crown(session, judge) {
      const experimentId = session.experimentId;
      if (!experimentId) return undefined;
      let selection: ExperimentJudgeSelection | undefined;
      if (judge?.brain.kind === "agent") {
        const project = requireProject(session.projectId);
        const agent = findProjectAgentStatus(project, judge.brain.agentKind);
        const disabled = useSharedSettings.getState().disabledAgents;
        if (agent && isEligibleExperimentJudgeAgent(agent, disabled)) {
          selection = {
            agentKind: agent.kind,
            model: judge.brain.model,
            fast: false,
            mode: "changes",
          };
        }
      }
      // Crowning never opens a view, so no guard: a long judge run must not
      // hold back the view of an experiment the user launches meanwhile.
      const crowned = await crownExperiment(experimentId, selection);
      if (!crowned) return undefined;
      const crown = useExperimentStore.getState().experiments[experimentId]?.crown;
      return crown
        ? {
            winnerThreadId: crown.threadId,
            ...(crown.rationale ? { rationale: crown.rationale } : {}),
          }
        : undefined;
    },
  };
}

/**
 * Where a sequential Roundtable works: the origin thread's checkout, a new
 * worktree branch, or the project root. Races always get one worktree per
 * participant from the experiment, so they need nothing here.
 */
export async function prepareWorkspace(
  input: StartRoundtableInput,
  sessionId: string,
): Promise<{ worktreePath?: string; worktreeBranch?: string }> {
  if (input.pattern === "race") return {};
  const project = requireProject(input.projectId);
  if (input.worktree?.mode === "new-branch") {
    const base = await readBridge()
      .gitListBranches({ projectLocation: project.location, includeRemote: false })
      .catch(() => undefined);
    const slug = sanitizeWorktreeBranchName(input.title?.trim() || input.task)
      .slice(0, 24)
      .replace(/[-.]+$/, "");
    const branch =
      input.worktree.branchName?.trim() || `viscosity/roundtable-${slug}-${sessionId.slice(0, 6)}`;
    const result = await createWorktree(project, {
      branch,
      ...(base?.current ? { startPoint: base.current } : {}),
      createBranch: true,
      transferUncommitted: false,
      keepChangesInSource: false,
    });
    // Setup script only: the git state is tracked once a participant thread registers the worktree.
    initializeCreatedWorktree(project, result.path, { trackGitState: false });
    return { worktreePath: result.path, worktreeBranch: branch };
  }
  if (input.originThreadId) {
    const origin = useAppStore
      .getState()
      .threads.find((thread) => thread.id === input.originThreadId);
    return {
      ...(origin?.worktreePath ? { worktreePath: origin.worktreePath } : {}),
      ...(origin?.worktreeBranch ? { worktreeBranch: origin.worktreeBranch } : {}),
    };
  }
  return {};
}

/** The origin thread's latest answer, and whether participants can read the thread itself. */
export async function readOriginContext(
  session: RoundtableSession,
  port: ThreadEnginePort,
): Promise<PlannerContext["origin"] | undefined> {
  const threadId = session.originThreadId;
  if (!threadId) return undefined;
  const snapshot = port.snapshot(threadId);
  if (!snapshot) return undefined;
  const text =
    snapshot.presentationMode === "terminal"
      ? await port.readTerminalText(threadId)
      : (await port.readLastTurn(threadId)).text;
  return { threadId, text, mention: port.readThreadToolEnabled() };
}
