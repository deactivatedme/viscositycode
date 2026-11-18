/**
 * ViscosityCode: "is the user already looking at it?" for the sound pack
 * (Step 5). The thread rule mirrors upstream's notification toasts: a thread
 * is on screen when a pane of this window shows it (or it is a candidate of
 * the open experiment), and not when it lives in its own thread window.
 *
 * The fork adds one rule: while a center panel (an open Roundtable, a bot
 * chat or Mission Control) covers the split view, the panes underneath are
 * hidden, so none of their threads counts as on screen. The panels' open
 * state is read from those features' view stores, never from their UI.
 */
import type { AppView } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { livesInAnotherWindow } from "@/renderer/state/auxiliaryThreadWindows";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useBotChatPanelStore } from "@/renderer/viscosity/bots/botChatPanelStore";
import { isMissionControlShown } from "@/renderer/viscosity/missionControl/missionControlViewStore";
import {
  isRoundtablePanelShown,
  useRoundtableViewStore,
} from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";

/** The window is visible and has focus. */
export function isAppInFront(doc: Document = document): boolean {
  return doc.visibilityState === "visible" && doc.hasFocus();
}

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
 * A center panel covers the split view: the open Roundtable, a bot's chat or
 * Mission Control. They render only in the desktop shell, where the sound
 * pack runs.
 */
export function isSplitViewCovered(): boolean {
  return (
    isRoundtablePanelShown(useRoundtableViewStore.getState()) ||
    useBotChatPanelStore.getState().openBotId !== null ||
    isMissionControlShown()
  );
}

export function isThreadOnScreen(threadId: string): boolean {
  if (livesInAnotherWindow(threadId)) return false;
  if (!isThreadShownInView(useAppStore.getState().view, threadId, experimentCandidateThreadIds)) {
    return false;
  }
  return !isSplitViewCovered();
}
