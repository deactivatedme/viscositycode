/**
 * ViscosityCode Roundtable UI: which Roundtable is open in the center panel
 * and whether the setup dialog is showing. A client view state of this
 * window only (never host state, never persisted): the engine owns sessions.
 *
 * The panel sits over the center split view like the inline file editor and
 * never changes `AppView` or the saved pane layout. It opens only on an
 * explicit user action (a list row, the tab, the status bar item); Start only
 * adds the tab in the background. It steps aside as soon as the user
 * navigates to a thread, a draft or the editor. Engine progress never brings
 * it forward.
 *
 * Desktop shell only: in the compact/PWA layout the open actions show a short
 * "desktop only" note instead.
 */
import { toast } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { create } from "zustand";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import type { ParticipantProfile, RoundtablePattern } from "../types";

/** Prefill for the setup dialog (in-chat entry points, "New Roundtable"). */
export interface RoundtableSetupRequest {
  projectId?: string;
  title?: string;
  task?: string;
  pattern?: RoundtablePattern;
  participants?: ParticipantProfile[];
  /** The thread the Roundtable starts from ("invite a model into this chat"). */
  originThreadId?: string;
}

interface RoundtableViewState {
  /** Session shown by the Roundtable tab; null when no tab is open. */
  openSessionId: string | null;
  /** Whether the panel currently covers the center split view. */
  shown: boolean;
  /** Open setup dialog; `nonce` remounts it so each opening starts fresh. */
  setup: { nonce: number; request: RoundtableSetupRequest } | null;
}

export const useRoundtableViewStore = create<RoundtableViewState>()(() => ({
  openSessionId: null,
  shown: false,
  setup: null,
}));

let setupNonce = 0;

function desktopOnly(): boolean {
  if (isViscosityShellActive()) return false;
  toast.info(i18n._(msg`Roundtable is available in the desktop app.`));
  return true;
}

function hideEditorPanel(): void {
  const editor = useFileEditorStore.getState();
  if (editor.overlayMode === "modal") editor.setOverlayMode(null);
}

/** Open a session in the center panel (and its tab). User actions only. */
export function openRoundtableView(sessionId: string): void {
  if (!sessionId || desktopOnly()) return;
  hideEditorPanel();
  useRoundtableViewStore.setState({ openSessionId: sessionId, shown: true });
}

/**
 * After a start: give the new session the Roundtable tab WITHOUT bringing it
 * forward, so nothing on screen switches (the user asked the app to stop
 * jumping to the tab). A Roundtable the user is reading stays put; the new
 * session is then one click away in the list and the status bar.
 */
export function openRoundtableTab(sessionId: string): void {
  if (!sessionId || !isViscosityShellActive()) return;
  const state = useRoundtableViewStore.getState();
  if (isRoundtablePanelShown(state) || state.openSessionId === sessionId) return;
  useRoundtableViewStore.setState({ openSessionId: sessionId, shown: false });
}

/** Bring the open session's panel forward again (its tab). */
export function showRoundtablePanel(): void {
  if (useRoundtableViewStore.getState().openSessionId === null) return;
  hideEditorPanel();
  useRoundtableViewStore.setState({ shown: true });
}

/** Step aside for the threads; the tab stays so the session is one click away. */
export function hideRoundtablePanel(): void {
  if (!useRoundtableViewStore.getState().shown) return;
  useRoundtableViewStore.setState({ shown: false });
}

/** Close the tab and the panel. The session itself keeps running in the engine. */
export function closeRoundtableView(): void {
  const state = useRoundtableViewStore.getState();
  if (state.openSessionId === null && !state.shown) return;
  useRoundtableViewStore.setState({ openSessionId: null, shown: false });
}

export function openRoundtableSetup(request: RoundtableSetupRequest = {}): void {
  if (desktopOnly()) return;
  setupNonce += 1;
  useRoundtableViewStore.setState({ setup: { nonce: setupNonce, request } });
}

export function closeRoundtableSetup(): void {
  if (useRoundtableViewStore.getState().setup === null) return;
  useRoundtableViewStore.setState({ setup: null });
}

export function isRoundtablePanelShown(state: RoundtableViewState): boolean {
  return state.shown && state.openSessionId !== null;
}

/**
 * Hide the panel when the user navigates elsewhere: opening a thread (any
 * `openThread`, which marks the pending active thread first), opening a
 * new-thread draft, switching the center view (draft, home, experiment, …)
 * or showing the inline editor.
 * Installed outside React by the center host; returns the unsubscribe.
 */
export function startRoundtableViewSync(): () => void {
  const unsubscribeEditor = useFileEditorStore.subscribe((state, previous) => {
    if (state.overlayMode === "modal" && previous.overlayMode !== "modal") hideRoundtablePanel();
  });
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    const openedThread =
      state.pendingActiveThreadId !== null &&
      state.pendingActiveThreadId !== previous.pendingActiveThreadId;
    // `draftVisit` moves on every new-thread draft (Cmd+N, the sidebar's New
    // thread, a side-by-side draft pane), even when the view kind stays the same.
    // Switching a draft's project (`moveDraft`) keeps both the kind and the visit.
    const movedDraft =
      state.view.kind === "draft" &&
      previous.view.kind === "draft" &&
      state.view.projectId !== previous.view.projectId;
    if (
      openedThread ||
      movedDraft ||
      state.draftVisit !== previous.draftVisit ||
      state.view.kind !== previous.view.kind
    ) {
      hideRoundtablePanel();
    }
  });
  return () => {
    unsubscribeEditor();
    unsubscribeApp();
  };
}
