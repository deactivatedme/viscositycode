/**
 * ViscosityCode tab strip actions. Every one delegates to an existing upstream
 * action (the sidebar's `openThread`, the pane close action, `openNewThread`,
 * the file editor's overlay mode) so tabs never own navigation of their own.
 */
import { startTransition } from "react";
import { resolveActivePaneId } from "@/renderer/actions/currentProject";
import { openNewThread, openThread } from "@/renderer/actions/threadActions";
import { isSplitViewCovered } from "@/renderer/viscosity/threadOnScreen";
import { useAppStore } from "@/renderer/state/appStore";
import { findExperimentByThreadId } from "@/renderer/state/experimentStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { getThreadMap } from "@/renderer/state/useThread";
import {
  closeMissionControl,
  useMissionControlViewStore,
} from "@/renderer/viscosity/missionControl/missionControlViewStore";
import {
  hideRoundtablePanel,
  useRoundtableViewStore,
} from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import {
  closeOpenTab,
  getRenderableTabIds,
  isOpenableThread,
  useOpenTabsStore,
} from "./openTabsStore";
import { resolveNextTabAfterClose } from "./openTabsModel";

/**
 * Show a thread in the focused pane with the sidebar's own `openThread`
 * (focus, composer hand-off, history warm-up, runtime reopen). That action
 * fills the first pane; in a split whose focused pane is another one, the
 * thread is first swapped into the focused pane, after which `openThread`
 * only focuses it. Group views, grouped threads (which `openThread` opens as
 * their group) and experiment threads keep `openThread`'s own rules.
 */
export function showThreadInFocusedPane(threadId: string): void {
  const state = useAppStore.getState();
  const view = state.view;
  if (
    view.kind === "thread" &&
    !view.activeGroupId &&
    view.panes.length > 1 &&
    !view.panes.includes(threadId) &&
    !getThreadMap(state.threads).get(threadId)?.groupId &&
    !findExperimentByThreadId(threadId)
  ) {
    const targetPaneId = resolveActivePaneId(view.panes, state.focusedPaneId);
    if (targetPaneId !== view.panes[0]) {
      startTransition(() => {
        state.replacePaneById(threadId, targetPaneId);
      });
    }
  }
  openThread(threadId);
}

/** Hide the inline file editor panel. Its open files and buffers stay in the store. */
export function hideEditorPanel(): void {
  const editor = useFileEditorStore.getState();
  if (editor.overlayMode === "modal") editor.setOverlayMode(null);
}

/**
 * Tab (or status bar) press: bring the thread forward over the editor and Roundtable panels.
 * A deleted or archived thread is ignored, so no fork link can reopen it.
 */
export function activateThreadTab(threadId: string): void {
  if (!isOpenableThread(threadId)) return;
  hideEditorPanel();
  // ViscosityCode: also step the Roundtable panel aside (its tab stays).
  hideRoundtablePanel();
  showThreadInFocusedPane(threadId);
}

/**
 * Close a tab. When its thread is the one in the focused pane, the next tab
 * takes that pane; with no next tab (or in a group view) the pane closes with
 * the existing close action. A thread on screen in another pane closes that
 * pane too, so the tab does not come straight back.
 */
export function closeThreadTab(threadId: string): void {
  const tabsBeforeClose = getRenderableTabIds();
  closeOpenTab(threadId);

  const state = useAppStore.getState();
  const view = state.view;
  if (view.kind !== "thread" || !view.panes.includes(threadId)) return;

  // ViscosityCode: under a cover panel (Roundtable, Mission Control) only close the
  // hidden pane: openThread or a view change would dismiss the panel, and filling the pane
  // would mount (and mark seen) a thread the user cannot see.
  if (isSplitViewCovered()) {
    if (view.panes.length > 1) state.closePane(threadId);
    else closePaneWhenUncovered(threadId);
    return;
  }
  const focusedPaneId = resolveActivePaneId(view.panes, state.focusedPaneId);
  if (focusedPaneId === threadId && !view.activeGroupId) {
    const nextThreadId = resolveNextTabAfterClose(tabsBeforeClose, threadId, view.panes);
    if (nextThreadId) {
      showThreadInFocusedPane(nextThreadId);
      return;
    }
  }
  state.closePane(threadId);
}

/**
 * ViscosityCode: closing the last pane goes home, which would dismiss the cover panel, so it
 * closes once the panel is gone, unless the user navigated meanwhile (that navigation owns
 * the pane) or reopened the tab.
 */
function closePaneWhenUncovered(threadId: string): void {
  const unsubscribes: Array<() => void> = [];
  const onPanelChange = () => {
    if (isSplitViewCovered()) return;
    for (const unsubscribe of unsubscribes) unsubscribe();
    // After the action that uncovered the split, so an openThread it starts is already pending.
    queueMicrotask(() => {
      // One panel replaced by another (each hides the others before it shows): keep waiting.
      if (isSplitViewCovered()) {
        closePaneWhenUncovered(threadId);
        return;
      }
      const state = useAppStore.getState();
      if (state.view.kind !== "thread" || !state.view.panes.includes(threadId)) return;
      if (state.pendingActiveThreadId !== null) return;
      if (useOpenTabsStore.getState().ids.includes(threadId)) return;
      state.closePane(threadId);
    });
  };
  unsubscribes.push(
    useRoundtableViewStore.subscribe(onPanelChange),
    useMissionControlViewStore.subscribe(onPanelChange),
  );
}

/** "+" in the tab strip: the same new-thread draft as the sidebar's button. */
export function openNewThreadTab(): void {
  hideEditorPanel();
  // ViscosityCode: the new draft shows in front of the Roundtable and Mission Control
  // panels (a draft-to-draft or side-by-side open changes nothing their syncs watch).
  hideRoundtablePanel();
  closeMissionControl();
  openNewThread();
}

/** The Editor tab toggles upstream's inline FileEditorPanel ("modal" overlay mode). */
export function toggleEditorTab(): void {
  const editor = useFileEditorStore.getState();
  if (!editor.rootContext) return;
  // ViscosityCode: showing the editor puts it in front of the Roundtable panel.
  if (editor.overlayMode !== "modal") hideRoundtablePanel();
  editor.setOverlayMode(editor.overlayMode === "modal" ? null : "modal");
}
