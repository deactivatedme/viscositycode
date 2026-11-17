/**
 * ViscosityCode status bar: primitive selectors for the focused pane's thread
 * (or the open draft's project). Each returns a string or undefined, so items
 * re-render only when that one value changes.
 */
import type { Thread } from "@/shared/contracts";
import { parseDraftProjectId } from "@/shared/paneId";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import type { useAppStore } from "@/renderer/state/appStore";
import { getThreadMap } from "@/renderer/state/useThread";

type AppState = ReturnType<typeof useAppStore.getState>;

function focusedThread(state: AppState): Thread | undefined {
  const paneId = selectFocusedThreadId(state);
  return paneId ? getThreadMap(state.threads).get(paneId) : undefined;
}

/** The focused real thread's id (not a draft pane), or null. */
export function selectFocusedRealThreadId(state: AppState): string | null {
  return focusedThread(state)?.id ?? null;
}

/** Project of the focused thread, of a draft pane, or of the full-page draft. */
export function selectFocusedProjectId(state: AppState): string | undefined {
  const thread = focusedThread(state);
  if (thread) return thread.projectId;
  const paneId = selectFocusedThreadId(state);
  if (paneId) return parseDraftProjectId(paneId);
  return state.view.kind === "draft" ? state.view.projectId : undefined;
}

export function selectFocusedWorktreePath(state: AppState): string | undefined {
  return focusedThread(state)?.worktreePath;
}

export function selectFocusedWorktreeBranch(state: AppState): string | undefined {
  return focusedThread(state)?.worktreeBranch;
}

export function selectFocusedAgentKind(state: AppState): string | undefined {
  return focusedThread(state)?.agentKind;
}

export function selectFocusedModel(state: AppState): string | undefined {
  return focusedThread(state)?.config.model;
}
