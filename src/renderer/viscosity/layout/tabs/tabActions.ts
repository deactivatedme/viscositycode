/**
 * ViscosityCode tab strip actions. Every one delegates to an existing upstream
 * action (the sidebar's `openThread`, the pane close action, `openNewThread`,
 * the file editor's overlay mode) so tabs never own navigation of their own.
 */
import { startTransition } from "react";
import { resolveActivePaneId } from "@/renderer/actions/currentProject";
import { openNewThread, openThread } from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";
import { findExperimentByThreadId } from "@/renderer/state/experimentStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { closeOpenTab, getRenderableTabIds } from "./openTabsStore";
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

/** Tab (or status bar) press: bring the thread forward over the editor panel. */
export function activateThreadTab(threadId: string): void {
  hideEditorPanel();
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

/** "+" in the tab strip: the same new-thread draft as the sidebar's button. */
export function openNewThreadTab(): void {
  hideEditorPanel();
  openNewThread();
}

/** The Editor tab toggles upstream's inline FileEditorPanel ("modal" overlay mode). */
export function toggleEditorTab(): void {
  const editor = useFileEditorStore.getState();
  if (!editor.rootContext) return;
  editor.setOverlayMode(editor.overlayMode === "modal" ? null : "modal");
}
