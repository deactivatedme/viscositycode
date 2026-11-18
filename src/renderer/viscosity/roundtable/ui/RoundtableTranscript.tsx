/**
 * ViscosityCode Roundtable UI: the group-chat transcript of a session — the
 * task card, the user's own messages, one bubble per turn (participant
 * avatar, name, phase or role, status, verdict, markdown answer), round
 * separators, the decision card and a failure notice.
 *
 * Only the running turn's preview subscribes to streaming text
 * (`useLiveTurnText`, throttled by the engine); every other bubble renders
 * from the session object, which changes on turn status, not on deltas.
 */
import { type RefObject, useEffect, useId, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@heroui/react";
import { CircleAlert, Crown, ExternalLink } from "lucide-react";
import { ItemMarkdown } from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";
import { activateThreadTab } from "@/renderer/viscosity/layout/tabs/tabActions";
import { useLiveTurnText } from "../api";
import type {
  ParticipantProfile,
  RoundtableNote,
  RoundtableSession,
  RoundtableTurn,
} from "../types";
import { ParticipantAvatar } from "./ParticipantAvatar";
import {
  displayMaxRounds,
  OUTCOME_LABELS,
  PHASE_LABELS,
  ROLE_LABELS,
  TURN_STATUS_LABELS,
} from "./patterns";

export type TranscriptEntry =
  | { kind: "round"; key: string; round: number }
  | { kind: "turn"; key: string; turn: RoundtableTurn }
  | { kind: "note"; key: string; note: RoundtableNote };

function noteBelongsBefore(note: RoundtableNote, turn: RoundtableTurn): boolean {
  if (turn.noteId === note.id || note.deliveredTurnId === turn.id) return true;
  return turn.startedAt !== undefined && note.createdAt <= turn.startedAt;
}

/**
 * Turns in order with a separator whenever the round changes, and the user's
 * messages placed before the first turn that answers, carries or follows them.
 */
export function buildTranscriptEntries(
  turns: readonly RoundtableTurn[],
  notes: readonly RoundtableNote[] = [],
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const queued = notes.toSorted((a, b) => a.createdAt - b.createdAt);
  let round: number | undefined;
  for (const turn of turns) {
    // Keep posting order: emit every queued note up to the last one that belongs here.
    const last = queued.findLastIndex((note) => noteBelongsBefore(note, turn));
    for (const note of queued.splice(0, last + 1)) {
      entries.push({ kind: "note", key: `note:${note.id}`, note });
    }
    if (turn.round !== round) {
      round = turn.round;
      entries.push({ kind: "round", key: `round:${turn.round}:${turn.id}`, round: turn.round });
    }
    entries.push({ kind: "turn", key: turn.id, turn });
  }
  for (const note of queued) entries.push({ kind: "note", key: `note:${note.id}`, note });
  return entries;
}

/** The turn that explains the decision: the newest PICK of the winner, else the newest PICK. */
export function findDecisionTurn(
  turns: readonly RoundtableTurn[],
  winnerId: string | undefined,
): RoundtableTurn | undefined {
  let fallback: RoundtableTurn | undefined;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.verdict !== "pick") continue;
    if (winnerId !== undefined && turn.pickedParticipantId === winnerId) return turn;
    fallback ??= turn;
  }
  return fallback;
}

function TurnTime(props: { at: number | undefined }) {
  const { i18n } = useLingui();
  if (props.at === undefined) return null;
  const date = new Date(props.at);
  return (
    <time className="vc-rt-turn__time" dateTime={date.toISOString()}>
      {i18n.date(date, { hour: "numeric", minute: "2-digit" })}
    </time>
  );
}

function VerdictBadge(props: {
  turn: RoundtableTurn;
  participants: readonly ParticipantProfile[];
}) {
  const { turn } = props;
  if (!turn.verdict) return null;
  if (turn.verdict === "approve") {
    return (
      <span className="vc-rt-verdict" data-verdict="approve">
        <Trans>Approve</Trans>
      </span>
    );
  }
  if (turn.verdict === "revise") {
    return (
      <span className="vc-rt-verdict" data-verdict="revise">
        <Trans>Revise</Trans>
      </span>
    );
  }
  const picked = props.participants.find(
    (participant) => participant.id === turn.pickedParticipantId,
  )?.label;
  return (
    <span className="vc-rt-verdict" data-verdict="pick">
      {picked ? <Trans>Pick → {picked}</Trans> : <Trans>Pick</Trans>}
    </span>
  );
}

function LiveTurnPreview(props: { sessionId: string; turnId: string }) {
  const text = useLiveTurnText(props.sessionId, props.turnId);
  if (!text) {
    return (
      <p className="vc-rt-turn__note vc-rt-turn__note--live">
        <span aria-hidden="true" className="vc-rt-typing">
          <span />
          <span />
          <span />
        </span>
        <Trans>Working…</Trans>
      </p>
    );
  }
  return (
    // aria-busy: the transcript is a polite live region (role="log"); without
    // it a screen reader would announce every streamed update. The finished
    // reply replaces this preview and is announced once.
    <div className="vc-rt-turn__markdown" data-live="" aria-busy="true">
      <ItemMarkdown text={text} />
    </div>
  );
}

function OpenThreadButton(props: { threadId: string | undefined; label: string }) {
  const { t } = useLingui();
  const { threadId } = props;
  if (!threadId) return null;
  const label = props.label;
  return (
    <Button
      size="sm"
      variant="tertiary"
      aria-label={t`Open ${label} thread`}
      onPress={() => activateThreadTab(threadId)}
    >
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <Trans>Open thread</Trans>
    </Button>
  );
}

function TurnBody(props: {
  sessionId: string;
  turn: RoundtableTurn;
  name: string;
  threadId: string | undefined;
}) {
  const { turn, name } = props;
  const { t } = useLingui();
  const response = turn.responseText?.trim() ? (
    <div className="vc-rt-turn__markdown">
      <ItemMarkdown text={turn.responseText} />
      {turn.truncated ? (
        <p className="vc-rt-turn__note">
          <Trans>Shortened to fit the Roundtable record. The full reply is in the thread.</Trans>
        </p>
      ) : null}
    </div>
  ) : null;
  switch (turn.status) {
    case "pending":
      return (
        <p className="vc-rt-turn__note">
          <Trans>Up next</Trans>
        </p>
      );
    case "running":
      return <LiveTurnPreview sessionId={props.sessionId} turnId={turn.id} />;
    case "waiting-approval":
      return (
        <div className="vc-rt-turn__callout" data-tone="attention" role="status">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <Trans>
              {name} is waiting for your approval. The Roundtable continues once you answer in its
              thread.
            </Trans>
          </span>
          <OpenThreadButton threadId={props.threadId} label={name} />
        </div>
      );
    case "failed":
      return (
        <>
          <p className="vc-rt-turn__error" role="alert">
            {turn.error?.trim() || t`This turn failed.`}
          </p>
          {response}
        </>
      );
    case "stopped":
      return (
        <>
          <p className="vc-rt-turn__note">
            <Trans>Stopped</Trans>
          </p>
          {response}
        </>
      );
    case "done":
      return (
        response ?? (
          <p className="vc-rt-turn__note">
            <Trans>No reply</Trans>
          </p>
        )
      );
  }
}

function NoteBubble(props: {
  note: RoundtableNote;
  participants: readonly ParticipantProfile[];
  turns: readonly RoundtableTurn[];
}) {
  const { note } = props;
  const { t } = useLingui();
  const nameOf = (participantId: string | undefined) =>
    props.participants.find((participant) => participant.id === participantId)?.label;
  const mentioned = (note.mentions ?? []).flatMap((id) => nameOf(id) ?? []);
  const delivered = note.deliveredTurnId
    ? nameOf(props.turns.find((turn) => turn.id === note.deliveredTurnId)?.participantId)
    : undefined;
  const to = mentioned.join(", ");
  return (
    <article
      className="vc-rt-turn vc-rt-turn--user"
      data-vc-rt-note={note.id}
      aria-label={t`Your message`}
    >
      <div className="vc-rt-turn__bubble">
        <header className="vc-rt-turn__meta">
          <span className="vc-rt-turn__name">
            <Trans>You</Trans>
          </span>
          {to ? (
            <span className="vc-rt-pill">
              <Trans>to {to}</Trans>
            </span>
          ) : null}
          <TurnTime at={note.createdAt} />
        </header>
        <div className="vc-rt-turn__markdown">
          <ItemMarkdown text={note.text} />
        </div>
        {delivered ? (
          <p className="vc-rt-turn__note">
            <Trans>Added to the next prompt of {delivered}</Trans>
          </p>
        ) : null}
      </div>
    </article>
  );
}

function TurnBubble(props: {
  sessionId: string;
  turn: RoundtableTurn;
  participants: readonly ParticipantProfile[];
  threadIds: Readonly<Record<string, string>>;
}) {
  const { turn } = props;
  const { i18n, t } = useLingui();
  const participant = props.participants.find((candidate) => candidate.id === turn.participantId);
  const name = participant?.label ?? t`Unknown participant`;
  const round = turn.round;
  const tag = turn.phase
    ? i18n._(PHASE_LABELS[turn.phase])
    : participant
      ? i18n._(ROLE_LABELS[participant.role])
      : null;
  return (
    <article
      className="vc-rt-turn"
      data-status={turn.status}
      data-vc-rt-turn={turn.id}
      aria-label={t`${name}, round ${round}`}
    >
      {participant ? (
        <ParticipantAvatar participant={participant} />
      ) : (
        <span aria-hidden="true" className="vc-rt-avatar" data-size="md" />
      )}
      <div className="vc-rt-turn__bubble">
        <header className="vc-rt-turn__meta">
          <span className="vc-rt-turn__name">{name}</span>
          {tag ? <span className="vc-rt-pill">{tag}</span> : null}
          {turn.status === "done" ? null : (
            <span className="vc-rt-pill" data-turn-status={turn.status}>
              {i18n._(TURN_STATUS_LABELS[turn.status])}
            </span>
          )}
          <VerdictBadge turn={turn} participants={props.participants} />
          <TurnTime at={turn.endedAt ?? turn.startedAt} />
        </header>
        <TurnBody
          sessionId={props.sessionId}
          turn={turn}
          name={name}
          threadId={participant ? props.threadIds[participant.id] : undefined}
        />
        {turn.prompt ? (
          <details className="vc-rt-turn__prompt">
            <summary>
              <Trans>Prompt sent</Trans>
            </summary>
            <div className="vc-rt-turn__prompt-text">{turn.prompt}</div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function RoundSeparator(props: { round: number; maxRounds: number }) {
  const max = displayMaxRounds(props.maxRounds);
  const round = props.round;
  return (
    <div className="vc-rt-round" role="separator">
      <span className="vc-rt-round__label">
        {max === null ? (
          <Trans>Round {round}</Trans>
        ) : (
          <Trans>
            Round {round} of {max}
          </Trans>
        )}
      </span>
    </div>
  );
}

function TaskCard(props: { task: string }) {
  const headingId = useId();
  return (
    <section className="vc-rt-task" aria-labelledby={headingId}>
      <h3 id={headingId} className="vc-rt-task__heading">
        <Trans>Task</Trans>
      </h3>
      <div className="vc-rt-turn__markdown">
        <ItemMarkdown text={props.task} />
      </div>
    </section>
  );
}

function DecisionCard(props: { session: RoundtableSession }) {
  const { session } = props;
  const { i18n, t } = useLingui();
  const winner = session.participants.find(
    (participant) => participant.id === session.winnerParticipantId,
  );
  const outcome = session.outcome;
  if (!winner && !outcome) return null;
  const decision = findDecisionTurn(session.turns, winner?.id);
  const rationale = outcome?.rationale?.trim() || decision?.responseText?.trim();
  const decidedBy = outcome?.rationale?.trim()
    ? undefined
    : session.participants.find((participant) => participant.id === decision?.participantId)?.label;
  const winnerName = winner?.label;
  return (
    <section className="vc-rt-decision" aria-label={t`Decision`}>
      <header className="vc-rt-decision__header">
        <Crown aria-hidden="true" className="size-4 shrink-0" />
        <span>
          <Trans>Decision</Trans>
        </span>
      </header>
      {outcome ? (
        <p className="vc-rt-decision__reason">{i18n._(OUTCOME_LABELS[outcome.reason])}</p>
      ) : null}
      {winner ? (
        <div className="vc-rt-decision__winner">
          <ParticipantAvatar participant={winner} />
          <span>
            <Trans>
              Winner: <strong>{winnerName}</strong>
            </Trans>
          </span>
        </div>
      ) : null}
      {rationale ? (
        <div className="vc-rt-decision__rationale">
          <p className="vc-rt-decision__by">
            {decidedBy ? <Trans>Rationale from {decidedBy}</Trans> : <Trans>Rationale</Trans>}
          </p>
          <div className="vc-rt-turn__markdown">
            <ItemMarkdown text={rationale} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FailureNotice(props: { session: RoundtableSession }) {
  const { t } = useLingui();
  if (props.session.status !== "failed") return null;
  return (
    <div className="vc-rt-turn__callout" data-tone="error" role="alert">
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {props.session.error?.trim() || t`The Roundtable stopped because of an error.`}
      </span>
    </div>
  );
}

/** Keep the newest message in view while the reader is at the bottom (no React state). */
function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    let pinned = true;
    const onScroll = () => {
      pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    };
    scroller.scrollTop = scroller.scrollHeight;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => scroller.removeEventListener("scroll", onScroll);
    }
    const observer = new ResizeObserver(() => {
      if (pinned) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, contentRef]);
}

export function RoundtableTranscript(props: { session: RoundtableSession }) {
  const { session } = props;
  const { t } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useStickToBottom(scrollRef, contentRef);
  const entries = buildTranscriptEntries(session.turns, session.notes);

  return (
    <div ref={scrollRef} className="vc-rt-transcript" role="log" aria-label={t`Transcript`}>
      <div ref={contentRef} className="vc-rt-transcript__content">
        <TaskCard task={session.task} />
        {entries.map((entry) => {
          switch (entry.kind) {
            case "round":
              return (
                <RoundSeparator key={entry.key} round={entry.round} maxRounds={session.maxRounds} />
              );
            case "note":
              return (
                <NoteBubble
                  key={entry.key}
                  note={entry.note}
                  participants={session.participants}
                  turns={session.turns}
                />
              );
            case "turn":
              return (
                <TurnBubble
                  key={entry.key}
                  sessionId={session.id}
                  turn={entry.turn}
                  participants={session.participants}
                  threadIds={session.threadIds}
                />
              );
          }
        })}
        <DecisionCard session={session} />
        <FailureNotice session={session} />
      </div>
    </div>
  );
}
