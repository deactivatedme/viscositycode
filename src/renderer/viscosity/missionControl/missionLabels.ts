/**
 * ViscosityCode Mission Control: the words on a card (fork of Poracode) —
 * its live state, its fx state for the shared agent-state colours, and its
 * time line. Pure (an `I18n` is passed in) so the wording is testable.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { FxAgentState } from "@/renderer/fx/agentState/derive";
import { formatAge } from "./missionClock";
import type { MissionLiveState } from "./missionActivity";
import type { MissionCard, MissionFilter } from "./missionModel";

/** `data-vc-fx-state` for a card: the agent-state colours of fx/agentState. */
export function missionFxState(
  card: Pick<MissionCard, "state">,
  live: MissionLiveState | null,
): FxAgentState {
  switch (card.state) {
    case "attention":
      return "attention";
    case "error":
      return "error";
    case "working":
      return live ?? "working";
    case "done":
    case "idle":
      return "idle";
  }
}

export function missionStateLabel(
  card: MissionCard,
  live: MissionLiveState | null,
  i18n: I18n,
): string {
  switch (card.state) {
    case "attention":
      if (card.kind === "roundtable") return i18n._(msg`Waiting for you`);
      return card.attentionKind === "reply"
        ? i18n._(msg`Needs your reply`)
        : i18n._(msg`Needs approval`);
    case "error":
      return i18n._(msg`Error`);
    case "working":
      if (live === "tool") return i18n._(msg`Running a tool`);
      if (live === "thinking") return i18n._(msg`Thinking`);
      if (live === "streaming") return i18n._(msg`Writing`);
      return i18n._(msg`Working`);
    case "done":
      return i18n._(msg`Done`);
    case "idle":
      if (card.kind === "roundtable" && card.status === "paused") return i18n._(msg`Paused`);
      return i18n._(msg`Idle`);
  }
}

const MINUTE_MS = 60_000;

/**
 * "Running 3m" for live work ("Started 3m ago" while it waits for the user),
 * "Finished 12m ago" after it, null when nothing is known.
 */
export function missionTimeLabel(
  card: Pick<MissionCard, "state" | "startedAt" | "endedAt">,
  now: number,
  i18n: I18n,
): string | null {
  if (card.startedAt !== undefined && (card.state === "working" || card.state === "attention")) {
    const age = formatAge(now - card.startedAt);
    return card.state === "working" ? i18n._(msg`Running ${age}`) : i18n._(msg`Started ${age} ago`);
  }
  if (card.endedAt === undefined) return null;
  const elapsed = now - card.endedAt;
  if (elapsed < MINUTE_MS) {
    return card.state === "done" ? i18n._(msg`Finished just now`) : i18n._(msg`Active just now`);
  }
  const age = formatAge(elapsed);
  return card.state === "done"
    ? i18n._(msg`Finished ${age} ago`)
    : i18n._(msg`Last active ${age} ago`);
}

export function missionFilterLabel(filter: MissionFilter, i18n: I18n): string {
  switch (filter) {
    case "all":
      return i18n._(msg`All`);
    case "needs":
      return i18n._(msg`Needs you`);
    case "working":
      return i18n._(msg`Working`);
    case "errors":
      return i18n._(msg`Errors`);
    case "done":
      return i18n._(msg`Done`);
  }
}
