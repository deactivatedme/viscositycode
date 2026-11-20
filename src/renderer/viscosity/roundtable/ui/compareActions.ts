/**
 * ViscosityCode Roundtable UI: "Continue with this one" for the side-by-side
 * comparison — keep working with the best answer in its own thread.
 *
 * The thread opens through the sidebar's own `openThread` (focus, composer
 * hand-off, history warm-up, and reopening an inactive runtime), standalone:
 * a participant thread belongs to its Roundtable's thread group, and opening
 * a grouped thread the usual way brings up the whole group (every participant
 * side by side). Continuing with one answer shows only that thread.
 *
 * `followUpMessage` prefills the first message of a team chat that continues
 * a finished session with the same AIs ("Ask everyone a follow-up",
 * "Continue as a team chat"): the new chat's threads start fresh, so the
 * message quotes the task and each participant's latest answer.
 */
import { msg } from "@lingui/core/macro";
import { openThread } from "@/renderer/actions/threadActions";
import { i18n } from "@/renderer/i18n/i18n";
import { isOpenableThread } from "@/renderer/viscosity/layout/tabs/openTabsStore";
import { hideEditorPanel } from "@/renderer/viscosity/layout/tabs/tabActions";
import type { RoundtableSession } from "../types";
import { hideRoundtablePanel } from "./roundtableViewStore";

/** Per quoted answer, so five long answers still leave the message readable. */
export const FOLLOW_UP_ANSWER_CAP = 4_000;

export function continueWithThread(threadId: string): void {
  // A deleted or archived thread never comes back through this link.
  if (!isOpenableThread(threadId)) return;
  hideEditorPanel();
  hideRoundtablePanel();
  openThread(threadId, { standalone: true });
}

/**
 * Quoted as a block; a zero-width space after each "@" keeps a quoted
 * "@name" from choosing who answers the new message (see `extractMentions`).
 */
function quote(text: string): string {
  return text
    .replaceAll("@", "@\u200B")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** The task and each participant's latest answer, as context for a follow-up message. */
export function followUpMessage(
  session: Pick<RoundtableSession, "task" | "participants" | "turns">,
): string {
  const parts: string[] = [];
  const task = session.task.trim();
  if (task) parts.push(i18n._(msg`Earlier task:`), quote(task));
  for (const participant of session.participants) {
    const answer = session.turns
      .findLast((turn) => turn.participantId === participant.id && turn.responseText?.trim())
      ?.responseText?.trim();
    if (!answer) continue;
    const name = participant.label;
    const text =
      answer.length > FOLLOW_UP_ANSWER_CAP ? `${answer.slice(0, FOLLOW_UP_ANSWER_CAP)}…` : answer;
    parts.push(i18n._(msg`${name} answered:`), quote(text));
  }
  if (parts.length === 0) return "";
  parts.push(i18n._(msg`My follow-up:`), "");
  return parts.join("\n\n");
}
