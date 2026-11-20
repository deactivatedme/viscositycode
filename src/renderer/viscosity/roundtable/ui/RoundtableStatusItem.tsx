/**
 * ViscosityCode Roundtable UI: status bar item for the running Roundtable,
 * e.g. "Roundtable · round 2/4 · Claude · Opus reviewing", or "Roundtable ·
 * ready" for a team chat that only waits for a message. Pressing it opens
 * the session. It re-renders on session changes (turn status), never on
 * streaming text.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button, Tooltip } from "@heroui/react";
import { UsersRound } from "lucide-react";
import { useRoundtableStore } from "../roundtableStore";
import type { RoundtableSession, RoundtableTurn } from "../types";
import {
  describeParticipantActivity,
  displayMaxRounds,
  findActiveTurn,
  isChatIdle,
} from "./patterns";
import { openRoundtableView } from "./roundtableViewStore";

export const ROUNDTABLE_STATUS_ITEM_ID = "roundtable";

const ITEM_CLASS = "vc-statusbar__item h-full min-w-0 shrink-0 gap-1 rounded-none px-2 font-normal";

type StatusCandidate = Pick<
  RoundtableSession,
  "id" | "pattern" | "status" | "turns" | "notes" | "updatedAt"
>;

/** Busy running sessions first, then paused ones, then idle team chats (only waiting for a message). */
function statusRank(session: StatusCandidate): number {
  if (session.status === "paused") return 2;
  if (session.status !== "running") return 0;
  return isChatIdle(session) ? 1 : 3;
}

/** The session the status bar follows: the newest of the highest rank (see `statusRank`). */
export function pickStatusSession<T extends StatusCandidate>(
  sessions: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const session of sessions) {
    const rank = statusRank(session);
    if (rank === 0) continue;
    const bestRank = best ? statusRank(best) : 0;
    if (rank > bestRank || (rank === bestRank && session.updatedAt > best!.updatedAt)) {
      best = session;
    }
  }
  return best;
}

/**
 * The 1-based round worth showing for a turn, with its limit when the turn
 * counts against it. The engine numbers rounds from 0, and debate critique
 * rounds from 1 (round 0 holds the proposals). Phases past the limit
 * (proposals, decisions, implementation, race runs, team replies) get none.
 */
export function displayRound(
  turn: Pick<RoundtableTurn, "round" | "phase">,
  maxRounds: number,
): { round: number; max: number | null } | null {
  let round: number;
  switch (turn.phase) {
    case undefined:
    case "build":
    case "review":
    case "plan":
    case "test":
    case "contribute":
      round = turn.round + 1;
      break;
    case "critique":
      round = turn.round;
      break;
    default:
      return null;
  }
  const max = displayMaxRounds(maxRounds);
  return { round, max: max !== null && round <= max ? max : null };
}

export interface RoundtableProgress {
  label: string;
  tone: "working" | "attention" | "inactive";
}

export function describeRoundtableProgress(
  session: Pick<
    RoundtableSession,
    "pattern" | "status" | "turns" | "notes" | "participants" | "maxRounds"
  >,
  i18n: I18n,
): RoundtableProgress {
  const parts = [i18n._(msg`Roundtable`)];
  if (isChatIdle(session)) {
    parts.push(i18n._(msg`ready`));
    return { label: parts.join(" · "), tone: "inactive" };
  }
  const open = session.pattern === "open";
  const active = findActiveTurn(session.turns);
  const shown = active ?? session.turns.at(-1);
  const round = shown && !open ? displayRound(shown, session.maxRounds) : null;
  if (round) {
    const { round: current, max } = round;
    parts.push(max === null ? i18n._(msg`round ${current}`) : i18n._(msg`round ${current}/${max}`));
  }
  let tone: RoundtableProgress["tone"] = "working";
  if (session.status === "paused") {
    parts.push(i18n._(msg`paused`));
    tone = "attention";
  } else if (active) {
    const participant = session.participants.find(
      (candidate) => candidate.id === active.participantId,
    );
    if (participant) {
      // A team chat has no roles: everyone replies.
      const role = open ? "member" : participant.role;
      parts.push(i18n._(describeParticipantActivity(role, participant.label, active.status)));
    }
    if (active.status === "waiting-approval") tone = "attention";
  } else if (session.turns.length === 0) {
    parts.push(i18n._(msg`starting`));
  }
  return { label: parts.join(" · "), tone };
}

export function RoundtableStatusItem() {
  const { i18n, t } = useLingui();
  const sessions = useRoundtableStore((state) => state.sessions);
  const session = pickStatusSession(Object.values(sessions));
  if (!session) return null;
  const progress = describeRoundtableProgress(session, i18n);
  const title = session.title;
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t`Open Roundtable ${title}: ${progress.label}`}
          data-vc-status-item={ROUNDTABLE_STATUS_ITEM_ID}
          data-tone={progress.tone}
          className={`${ITEM_CLASS} max-w-[48ch]`}
          onPress={() => openRoundtableView(session.id)}
        >
          <UsersRound aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{progress.label}</span>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top">{t`Open Roundtable ${title}`}</Tooltip.Content>
    </Tooltip>
  );
}
