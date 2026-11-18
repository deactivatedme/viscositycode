/**
 * ViscosityCode Roundtable UI: status bar item for the running Roundtable,
 * e.g. "Roundtable · round 2/4 · Claude · Opus reviewing". Pressing it opens
 * the session. It re-renders on session changes (turn status), never on
 * streaming text.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button, Tooltip } from "@heroui/react";
import { UsersRound } from "lucide-react";
import { type RoundtableSummary, useRoundtableList, useRoundtableSession } from "../api";
import type { RoundtableSession } from "../types";
import { describeParticipantActivity, displayMaxRounds, findActiveTurn } from "./patterns";
import { openRoundtableView } from "./roundtableViewStore";

export const ROUNDTABLE_STATUS_ITEM_ID = "roundtable";

const ITEM_CLASS = "vc-statusbar__item h-full min-w-0 shrink-0 gap-1 rounded-none px-2 font-normal";

/** The session the status bar follows: the newest running one, else the newest paused one. */
export function pickStatusSession(
  sessions: readonly RoundtableSummary[],
): RoundtableSummary | undefined {
  let best: RoundtableSummary | undefined;
  for (const session of sessions) {
    if (session.status !== "running" && session.status !== "paused") continue;
    if (
      !best ||
      (session.status === "running" && best.status !== "running") ||
      (session.status === best.status && session.updatedAt > best.updatedAt)
    ) {
      best = session;
    }
  }
  return best;
}

export interface RoundtableProgress {
  label: string;
  tone: "working" | "attention";
}

export function describeRoundtableProgress(
  session: Pick<RoundtableSession, "status" | "turns" | "participants" | "maxRounds">,
  i18n: I18n,
): RoundtableProgress {
  const parts = [i18n._(msg`Roundtable`)];
  const active = findActiveTurn(session.turns);
  const round = active?.round ?? session.turns.at(-1)?.round ?? 0;
  const max = displayMaxRounds(session.maxRounds);
  if (round > 0) {
    parts.push(max === null ? i18n._(msg`round ${round}`) : i18n._(msg`round ${round}/${max}`));
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
      parts.push(
        i18n._(describeParticipantActivity(participant.role, participant.label, active.status)),
      );
    }
    if (active.status === "waiting-approval") tone = "attention";
  } else if (session.turns.length === 0) {
    parts.push(i18n._(msg`starting`));
  }
  return { label: parts.join(" · "), tone };
}

export function RoundtableStatusItem() {
  const { i18n, t } = useLingui();
  const sessions = useRoundtableList();
  const target = pickStatusSession(sessions);
  const session = useRoundtableSession(target?.id);
  if (!target || !session) return null;
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
