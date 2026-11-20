/**
 * ViscosityCode Mission Control: what a card's buttons do (fork of Poracode).
 * Every action reuses an existing one — the tab strip's thread activation,
 * the Roundtable view, the composer's interrupt, the Roundtable
 * stop — so Mission Control owns no navigation or process control of its own.
 *
 * "Review request" only brings the waiting thread forward; the user answers
 * the approval or question there. Nothing here ever approves on their behalf.
 */
import { toast } from "@heroui/react";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { activateThreadTab } from "@/renderer/viscosity/layout/tabs/tabActions";
import { interruptRoundtable, stopRoundtable } from "@/renderer/viscosity/roundtable/api";
import { openRoundtableView } from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { closeMissionControl } from "./missionControlViewStore";
import type { MissionCard } from "./missionModel";

function reportError(error: unknown): void {
  toast.danger(friendlyError(error));
}

/** Bring a thread forward in the focused pane; Mission Control steps aside for it. */
function showThread(threadId: string): void {
  activateThreadTab(threadId);
  closeMissionControl();
}

function showRoundtable(sessionId: string): void {
  openRoundtableView(sessionId);
  closeMissionControl();
}

/** Open: the thread in the focused pane or the Roundtable view. */
export function openMissionCard(card: MissionCard): void {
  switch (card.kind) {
    case "thread":
      showThread(card.threadId);
      return;
    case "roundtable":
      showRoundtable(card.sessionId);
      return;
  }
}

/** Review request: bring forward the thread where the user answers. Never answers it. */
export function reviewMissionCard(card: MissionCard): void {
  switch (card.kind) {
    case "thread":
      showThread(card.threadId);
      return;
    case "roundtable":
      if (card.reviewThreadId) showThread(card.reviewThreadId);
      else showRoundtable(card.sessionId);
      return;
  }
}

/**
 * Stop: the same interrupt as the composer's Stop. A Roundtable does what its
 * own Stop does: a team chat stops its current replies, other patterns end.
 */
export async function stopMissionCard(card: MissionCard): Promise<void> {
  if (!card.canStop) return;
  try {
    switch (card.kind) {
      case "thread":
        await readBridge().interruptThread({ threadId: card.threadId });
        return;
      case "roundtable":
        await (card.pattern === "open"
          ? interruptRoundtable(card.sessionId)
          : stopRoundtable(card.sessionId));
        return;
    }
  } catch (error) {
    reportError(error);
  }
}
