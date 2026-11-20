/**
 * ViscosityCode Roundtable UI: the group-chat transcript of a session — the
 * task card, the user's own messages, one bubble per turn (participant
 * avatar, name, phase or role, status, verdict, markdown answer, Copy and
 * Open thread), round separators, the decision card and a failure notice.
 * A team chat ("open", "Work together") shows no rounds, phases or roles,
 * and its collapsed shared instructions sit at the top.
 *
 * Only the running turn's preview subscribes to streaming text
 * (`useLiveTurnText`, throttled by the engine); every other bubble renders
 * from the session object, which changes on turn status, not on deltas.
 */
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Tooltip } from "@heroui/react";
import { CircleAlert, CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { CopyTextButton } from "@/renderer/components/thread/ChatPane/parts/items/CopyTextButton";
import { ItemMarkdown } from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";
import { useIsOpenableThread } from "@/renderer/viscosity/layout/tabs/openTabsStore";
import { activateThreadTab } from "@/renderer/viscosity/layout/tabs/tabActions";
import { useLiveTurnText } from "../api";
import type {
  ParticipantProfile,
  RoundtableNote,
  RoundtableSession,
  RoundtableTurn,
} from "../types";
import { ParticipantAvatar } from "./ParticipantAvatar";
import { OUTCOME_LABELS, PHASE_LABELS, ROLE_LABELS, TURN_STATUS_LABELS } from "./patterns";
import { displayRound } from "./RoundtableStatusItem";

export type TranscriptEntry =
  | { kind: "round"; key: string; round: number; turn: RoundtableTurn }
  | { kind: "turn"; key: string; turn: RoundtableTurn }
  | { kind: "note"; key: string; note: RoundtableNote };

function noteBelongsBefore(note: RoundtableNote, turn: RoundtableTurn): boolean {
  if (turn.noteId === note.id || note.deliveredTurnId === turn.id) return true;
  return turn.startedAt !== undefined && note.createdAt <= turn.startedAt;
}

/**
 * Turns in order with a separator whenever the round changes (unless
 * `separateRounds` is false: a team chat has no rounds), and the user's
 * messages placed before the first turn that answers, carries or follows them.
 */
export function buildTranscriptEntries(
  turns: readonly RoundtableTurn[],
  notes: readonly RoundtableNote[] = [],
  separateRounds = true,
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
    if (separateRounds && turn.round !== round) {
      round = turn.round;
      entries.push({
        kind: "round",
        key: `round:${turn.round}:${turn.id}`,
        round: turn.round,
        turn,
      });
    }
    entries.push({ kind: "turn", key: turn.id, turn });
  }
  for (const note of queued) entries.push({ kind: "note", key: `note:${note.id}`, note });
  return entries;
}

/**
 * Whether the task card adds anything: not when it is empty, nor in a team
 * chat whose task is just its first message (shown as that message anyway).
 */
export function showsTaskCard(
  session: Pick<RoundtableSession, "pattern" | "task" | "notes">,
): boolean {
  const task = session.task.trim();
  if (!task) return false;
  return !(session.pattern === "open" && session.notes?.[0]?.text.trim() === task);
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
        <Trans>Approved</Trans>
      </span>
    );
  }
  if (turn.verdict === "revise") {
    return (
      <span className="vc-rt-verdict" data-verdict="revise">
        <Trans>Changes requested</Trans>
      </span>
    );
  }
  const picked = props.participants.find(
    (participant) => participant.id === turn.pickedParticipantId,
  )?.label;
  return (
    <span className="vc-rt-verdict" data-verdict="pick">
      {picked ? <Trans>Recommends {picked}</Trans> : <Trans>Recommendation</Trans>}
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
  // A deleted or archived thread is not offered.
  const openable = useIsOpenableThread(threadId);
  if (!threadId || !openable) return null;
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

/** A turn's body by status (also one column of the side-by-side comparison). */
export function TurnBody(props: {
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
  // "Stop replies" halts every note so far; only label the ones it actually cut short.
  const noteTurns = props.turns.filter((turn) => turn.noteId === note.id);
  const seated = props.participants
    .filter((participant) => (participant.joinedAt ?? 0) <= note.createdAt)
    .map((participant) => participant.id);
  const mentionedIds = (note.mentions ?? []).filter((id) => nameOf(id) !== undefined);
  const addressed = mentionedIds.length > 0 ? mentionedIds : seated;
  const cutShort =
    note.halted === true &&
    (noteTurns.some((turn) => turn.status === "stopped") ||
      addressed.some((id) => !noteTurns.some((turn) => turn.participantId === id)));
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
        {cutShort ? (
          <p className="vc-rt-turn__note">
            <Trans>You stopped the replies to this message.</Trans>
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Copy the answer and open the participant's thread, once a turn has settled. */
function TurnActions(props: { turn: RoundtableTurn; name: string; threadId: string | undefined }) {
  const { turn, threadId } = props;
  const { t } = useLingui();
  const openable = useIsOpenableThread(threadId);
  if (turn.status === "pending" || turn.status === "running") return null;
  // Waiting turns already offer the thread in their callout; a deleted or archived one is gone.
  const showThread = threadId !== undefined && openable && turn.status !== "waiting-approval";
  const text = turn.responseText?.trim();
  if (!text && !showThread) return null;
  const name = props.name;
  const openLabel = t`Open ${name} thread`;
  return (
    <div className="rt-view-turn-actions">
      {text ? <CopyTextButton text={text} label={t`Copy answer`} /> : null}
      {showThread ? (
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={openLabel}
              className="size-6 min-w-6 text-muted"
              onPress={() => activateThreadTab(threadId)}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="top">{openLabel}</Tooltip.Content>
        </Tooltip>
      ) : null}
    </div>
  );
}

function TurnBubble(props: {
  sessionId: string;
  turn: RoundtableTurn;
  session: RoundtableSession;
}) {
  const { turn, session } = props;
  const { i18n, t } = useLingui();
  const open = session.pattern === "open";
  const participant = session.participants.find((candidate) => candidate.id === turn.participantId);
  const name = participant?.label ?? t`Unknown participant`;
  const threadId = participant ? session.threadIds[participant.id] : undefined;
  // A team chat has no phases or roles: every turn is a reply.
  const tag = open
    ? null
    : turn.phase
      ? i18n._(PHASE_LABELS[turn.phase])
      : participant
        ? i18n._(ROLE_LABELS[participant.role])
        : null;
  const shownRound = open ? null : displayRound(turn, session.maxRounds);
  const roundNumber = shownRound?.round;
  const label = shownRound ? t`${name}, round ${roundNumber}` : tag ? `${name}, ${tag}` : name;
  return (
    <article
      className="vc-rt-turn"
      data-status={turn.status}
      data-vc-rt-turn={turn.id}
      aria-label={label}
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
          <VerdictBadge turn={turn} participants={session.participants} />
          <TurnTime at={turn.endedAt ?? turn.startedAt} />
        </header>
        <TurnBody sessionId={props.sessionId} turn={turn} name={name} threadId={threadId} />
        <TurnActions turn={turn} name={name} threadId={threadId} />
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

function RoundSeparator(props: { turn: RoundtableTurn; maxRounds: number }) {
  const { turn } = props;
  const { i18n } = useLingui();
  const shown = displayRound(turn, props.maxRounds);
  const round = shown?.round;
  const max = shown?.max;
  let label: ReactNode;
  if (shown) {
    label =
      max === null ? (
        <Trans>Round {round}</Trans>
      ) : (
        <Trans>
          Round {round} of {max}
        </Trans>
      );
  } else if (turn.phase === "propose") {
    label = <Trans>Proposals</Trans>;
  } else {
    label = turn.phase ? i18n._(PHASE_LABELS[turn.phase]) : null;
  }
  if (label === null) return null;
  return (
    <div className="vc-rt-round" role="separator">
      <span className="vc-rt-round__label">{label}</span>
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

/** The shared instructions, collapsed: they matter, but the conversation comes first. */
function InstructionsCard(props: { instructions: string }) {
  return (
    <details className="vc-rt-task rt-view-instructions">
      <summary className="vc-rt-task__heading rt-view-instructions__summary">
        <Trans>Instructions for everyone</Trans>
      </summary>
      <div className="vc-rt-turn__markdown">
        <ItemMarkdown text={props.instructions} />
      </div>
    </details>
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
  // Running out of rounds is not a result to celebrate: the work was not approved.
  const unapproved = outcome?.reason === "max-rounds";
  const heading = unapproved ? t`Not approved yet` : t`Result`;
  const Icon = unapproved ? TriangleAlert : CircleCheck;
  return (
    <section className="vc-rt-decision" aria-label={heading}>
      <header className="vc-rt-decision__header">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span>{heading}</span>
      </header>
      {outcome ? (
        <p className="vc-rt-decision__reason">{i18n._(OUTCOME_LABELS[outcome.reason])}</p>
      ) : null}
      {winner ? (
        <div className="vc-rt-decision__winner">
          <ParticipantAvatar participant={winner} />
          <span>
            <Trans>
              Recommended: <strong>{winnerName}</strong>
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
          <div className="rt-view-turn-actions">
            <CopyTextButton text={rationale} label={t`Copy rationale`} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function FailureNotice(props: { session: RoundtableSession }) {
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
  const entries = buildTranscriptEntries(session.turns, session.notes, session.pattern !== "open");
  const instructions = session.instructions?.trim();

  return (
    <div ref={scrollRef} className="vc-rt-transcript" role="log" aria-label={t`Transcript`}>
      <div ref={contentRef} className="vc-rt-transcript__content">
        {instructions ? <InstructionsCard instructions={instructions} /> : null}
        {showsTaskCard(session) ? <TaskCard task={session.task} /> : null}
        {entries.map((entry) => {
          switch (entry.kind) {
            case "round":
              return (
                <RoundSeparator key={entry.key} turn={entry.turn} maxRounds={session.maxRounds} />
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
                  session={session}
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
