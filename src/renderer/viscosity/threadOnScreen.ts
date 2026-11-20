/**
 * ViscosityCode: "is the user already looking at it?" for notifications. The thread rule mirrors upstream's notification toasts: a thread
 * is on screen when a pane of this window shows it (or it is a candidate of
 * the open experiment), and not when it lives in its own thread window.
 *
 * The fork adds its own rules: while a center panel (an open Roundtable,
 * Mission Control or the inline editor) covers the split view, the panes underneath are
 * hidden, so none of their threads counts as on screen; the shown Roundtable's
 * participant threads are on screen instead. Zen mode shows only the focused
 * pane. The side chat thread counts while the right panel shows it (never in
 * Zen, which hides that panel). Open state is read from view stores, never
 * from the UI.
 *
 * Registered for upstream's notifications (`threadVisibilityHook`) by
 * ViscosityShellRuntime, so toasts and OS banners follow these rules in the
 * desktop shell.
 */
import type { AppView } from "@/shared/contracts";
import { useSideChatPanelStore } from "@/renderer/components/thread/SideChat/sideChatPanelStore";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { livesInAnotherWindow } from "@/renderer/state/auxiliaryThreadWindows";
import { isTabBottomDocked } from "@/renderer/state/panelDockSelectors";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useRoundtableStore } from "@/renderer/viscosity/roundtable/roundtableStore";
import { isZenModeActive } from "@/renderer/viscosity/zen/zenModeStore";
import { isMissionControlShown } from "@/renderer/viscosity/missionControl/missionControlViewStore";
import {
  isRoundtablePanelShown,
  useRoundtableViewStore,
} from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";

export function isThreadShownInView(
  view: AppView,
  threadId: string,
  candidatesOf: (experimentId: string) => readonly string[],
): boolean {
  if (view.kind === "thread") return view.panes.includes(threadId);
  if (view.kind === "experiment") return candidatesOf(view.experimentId).includes(threadId);
  return false;
}

function experimentCandidateThreadIds(experimentId: string): readonly string[] {
  const experiment = useExperimentStore.getState().experiments[experimentId];
  return experiment ? experiment.candidates.map((candidate) => candidate.threadId) : [];
}

/**
 * A center panel covers the split view: the open Roundtable or Mission
 * Control. They render only in the desktop shell.
 */
export function isSplitViewCovered(): boolean {
  return isRoundtablePanelShown(useRoundtableViewStore.getState()) || isMissionControlShown();
}

/** A participant thread of the Roundtable shown in the center panel. */
function isRoundtableParticipantShown(threadId: string): boolean {
  const view = useRoundtableViewStore.getState();
  if (!isRoundtablePanelShown(view) || view.openSessionId === null) return false;
  const session = useRoundtableStore.getState().sessions[view.openSessionId];
  return session ? Object.values(session.threadIds).includes(threadId) : false;
}

/**
 * The requested right-panel tab cannot show, so ProjectAuxiliaryPanel falls
 * back to the side chat (its first fallback when the side chat is open).
 * shortcut: covers the panel-store-derivable cases only (closed browser,
 * ports, devices or sub-agent tab, a bottom-docked tab); the docks-dependent
 * cases need ProjectAuxiliaryPanel's tab resolution as a shared pure helper.
 */
function requestedTabCannotShow(
  panel: ReturnType<typeof usePanelStore.getState>,
  focusedThreadId: string | null,
): boolean {
  const tab = panel.rightPanelTab;
  if (isTabBottomDocked(tab)) return true;
  if (tab === "browser") return !panel.browserPanelOpen;
  if (tab === "ports") return !panel.portsPanelOpen;
  if (tab === "devices")
    return panel.deviceWorkspaceThreadId === null || panel.deviceWorkspaceDetached;
  if (tab === "subagent") return panel.subAgentPanelContext?.threadId !== focusedThreadId;
  return false;
}

/**
 * The side chat thread in the right panel. Mirrors upstream's panel: the
 * entry is scoped to the focused pane's thread and its tab (or split) shows.
 */
function isSideChatShown(threadId: string): boolean {
  if (isZenModeActive()) return false;
  const entry = useSideChatPanelStore.getState().entry;
  if (!entry || entry.existingThreadId !== threadId) return false;
  const panel = usePanelStore.getState();
  if (!panel.sideChatPanelOpen) return false;
  const focusedThreadId = selectFocusedThreadId(useAppStore.getState());
  if (entry.source.id !== focusedThreadId) return false;
  return (
    panel.rightPanelTab === "sideChat" ||
    panel.rightPanelSplit?.tab === "sideChat" ||
    requestedTabCannotShow(panel, focusedThreadId)
  );
}

export function isThreadOnScreen(threadId: string): boolean {
  if (livesInAnotherWindow(threadId)) return false;
  if (isRoundtableParticipantShown(threadId) || isSideChatShown(threadId)) return true;
  const { view, focusedPaneId } = useAppStore.getState();
  if (!isThreadShownInView(view, threadId, experimentCandidateThreadIds)) return false;
  if (isSplitViewCovered()) return false;
  // The inline editor covers the panes too.
  const editor = useFileEditorStore.getState();
  if (editor.overlayMode === "modal" && editor.rootContext !== null) return false;
  // Zen shows only the focused pane of a split; without a known focused pane
  // zen tags nothing and the whole split stays visible.
  if (view.kind === "thread" && isZenModeActive() && focusedPaneId !== null) {
    if (view.panes.includes(focusedPaneId)) return focusedPaneId === threadId;
  }
  return true;
}
