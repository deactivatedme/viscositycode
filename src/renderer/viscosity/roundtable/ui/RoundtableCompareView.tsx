/**
 * ViscosityCode Roundtable UI: the side-by-side comparison of a "compare"
 * session (additive, AA compare) — one column per participant (2–5) with its
 * model, accent colour, status, time taken and markdown answer. The columns
 * scroll together. "Continue with this one" opens that participant's thread
 * on its own; "Ask everyone a follow-up" opens a team chat with the same AIs,
 * prefilled with the question and their answers; "Start a debate from here"
 * starts a debate seeded with these answers. Each answer has a Copy button.
 *
 * Only a running column subscribes to streaming text (through `TurnBody`)
 * and ticks its clock once a second; everything else renders from the
 * session object, which changes on turn status, not on deltas.
 */
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Button, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowRightToLine, MessageCirclePlus, MessagesSquare, Timer } from "lucide-react";
import type { AgentStatus } from "@/shared/contracts";
import { resolveModelLabel } from "@/renderer/components/providers/modelDisplay";
import { CopyTextButton } from "@/renderer/components/thread/ChatPane/parts/items/CopyTextButton";
import { ItemMarkdown } from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";
import { useHostAgentStatuses } from "@/renderer/hooks/useHostAgentStatuses";
import { useProject } from "@/renderer/state/useThread";
import { formatElapsed } from "@/renderer/utils/formatTime";
import { agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import { useIsOpenableThread } from "@/renderer/viscosity/layout/tabs/openTabsStore";
import {
  type CompareAnswer,
  canSeedDebate,
  compareAnswers,
  startDebateFromComparison,
  useHasActiveSeededDebate,
  useLatestSeededDebateId,
} from "../api";
import type { ParticipantProfile, RoundtableSession, RoundtableTurn } from "../types";
import { continueWithThread, followUpMessage } from "./compareActions";
import {
  answerDurationMs,
  COMPARE_BODY_ATTRIBUTE,
  compareProgress,
  installScrollSync,
} from "./compareModel";
import { ParticipantAvatar } from "./ParticipantAvatar";
import { TURN_STATUS_LABELS } from "./patterns";
import {
  openRoundtableSetup,
  openRoundtableTab,
  openRoundtableView,
  useRoundtableViewStore,
} from "./roundtableViewStore";
import { FailureNotice, TurnBody } from "./RoundtableTranscript";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRunning(turn: RoundtableTurn | undefined): boolean {
  return turn?.status === "running" || turn?.status === "waiting-approval";
}

/** Wall clock that ticks once a second while `active`, and not at all otherwise. */
function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function AnswerTime(props: { turn: RoundtableTurn | undefined }) {
  const { t } = useLingui();
  const now = useTickingNow(isRunning(props.turn));
  const ms = answerDurationMs(props.turn, now);
  if (ms === null) return null;
  const elapsed = formatElapsed(Math.round(ms / 1_000));
  const label = isRunning(props.turn) ? t`Running for ${elapsed}` : t`Took ${elapsed}`;
  return (
    <span className="vc-rt-compare__time" title={label}>
      <Timer aria-hidden="true" className="size-3" />
      <span aria-hidden="true">{elapsed}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function modelLabelOf(
  participant: ParticipantProfile,
  agentStatuses: readonly AgentStatus[],
): string {
  const brain = participant.brain;
  if (brain.kind !== "agent") return brain.model;
  const agent = agentStatuses.find((candidate) => candidate.kind === brain.agentKind);
  return resolveModelLabel(agent, brain.model) ?? brain.model;
}

function CompareColumn(props: {
  session: RoundtableSession;
  answer: CompareAnswer;
  modelLabel: string;
}) {
  const { session, answer } = props;
  const { participant, turn } = answer;
  const { i18n, t } = useLingui();
  const headingId = useId();
  const name = participant.label;
  const seatThreadId = session.threadIds[participant.id];
  // A deleted or archived thread cannot be continued.
  const threadId = useIsOpenableThread(seatThreadId) ? seatThreadId : undefined;
  const agentKind = participant.brain.kind === "agent" ? participant.brain.agentKind : undefined;
  const status = turn?.status;
  const answerText = status === "done" ? turn?.responseText?.trim() : undefined;
  return (
    <section
      role="listitem"
      className="vc-rt-compare__column"
      data-vc-rt-compare-column={participant.id}
      data-status={status ?? "waiting"}
      aria-labelledby={headingId}
      {...agentKindAttribute(agentKind)}
    >
      <header className="vc-rt-compare__head">
        <ParticipantAvatar participant={participant} />
        <span className="vc-rt-compare__title">
          <h3 id={headingId} className="vc-rt-compare__name" title={name}>
            {name}
          </h3>
          <span className="vc-rt-compare__model" title={props.modelLabel}>
            {props.modelLabel}
          </span>
        </span>
        {status && status !== "done" ? (
          <span className="vc-rt-pill" data-turn-status={status}>
            {i18n._(TURN_STATUS_LABELS[status])}
          </span>
        ) : null}
        <AnswerTime turn={turn} />
      </header>
      <div
        className="vc-rt-compare__body"
        {...{ [COMPARE_BODY_ATTRIBUTE]: "" }}
        role="region"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus enables native scrolling (and with it, every column's)
        tabIndex={0}
        aria-label={t`Answer from ${name}`}
      >
        {turn ? (
          <TurnBody sessionId={session.id} turn={turn} name={name} threadId={threadId} />
        ) : (
          <p className="vc-rt-turn__note">
            <Trans>Waiting to start…</Trans>
          </p>
        )}
      </div>
      {threadId || answerText ? (
        <footer className="vc-rt-compare__foot">
          {answerText ? <CopyTextButton text={answerText} label={t`Copy answer`} /> : null}
          {threadId ? (
            <Button
              size="sm"
              variant="secondary"
              // The visible label stays the accessible name (voice control); the column names the model.
              aria-describedby={headingId}
              onPress={() => continueWithThread(threadId)}
            >
              <ArrowRightToLine aria-hidden="true" className="size-3.5" />
              <Trans>Continue with this one</Trans>
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

function DebateActions(props: { session: RoundtableSession; answered: number }) {
  const { session } = props;
  const { t } = useLingui();
  const hintId = useId();
  const [starting, setStarting] = useState(false);
  const debateId = useLatestSeededDebateId(session.id);
  const debateRunning = useHasActiveSeededDebate(session.id);
  const ended = session.status !== "running" && session.status !== "paused";
  const canStart = canSeedDebate(session) && !debateRunning;

  async function startDebate() {
    if (!canStart || starting) return;
    setStarting(true);
    try {
      const id = await startDebateFromComparison(session.id);
      // The user asked for it from this panel: show the debate in its place,
      // unless they moved on meanwhile (then it only gets the tab, in the background).
      const view = useRoundtableViewStore.getState();
      if (view.shown && view.openSessionId === session.id) openRoundtableView(id);
      else openRoundtableTab(id);
      toast.success(t`Debate started`);
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setStarting(false);
    }
  }

  // While answers arrive, the progress line says enough.
  const hint = !ended
    ? null
    : props.answered < 2
      ? t`A debate needs at least two answers.`
      : debateRunning
        ? t`A debate from this comparison is running.`
        : null;

  return (
    <div className="vc-rt-compare__actions">
      {hint ? (
        <span id={hintId} className="vc-rt-compare__hint">
          {hint}
        </span>
      ) : null}
      {debateId ? (
        <Button size="sm" variant="ghost" onPress={() => openRoundtableView(debateId)}>
          <Trans>Open debate</Trans>
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        isDisabled={!ended || props.answered === 0}
        onPress={() =>
          openRoundtableSetup({
            projectId: session.projectId,
            pattern: "open",
            participants: session.participants,
            title: session.title,
            task: followUpMessage(session),
          })
        }
      >
        <MessageCirclePlus aria-hidden="true" className="size-3.5" />
        <Trans>Ask everyone a follow-up</Trans>
      </Button>
      <Button
        size="sm"
        variant="tertiary"
        isDisabled={!canStart}
        isPending={starting}
        {...(hint ? { "aria-describedby": hintId } : {})}
        onPress={() => void startDebate()}
      >
        <MessagesSquare aria-hidden="true" className="size-3.5" />
        <Trans>Start a debate from here</Trans>
      </Button>
    </div>
  );
}

export function RoundtableCompareView(props: { session: RoundtableSession }) {
  const { session } = props;
  const { t } = useLingui();
  const taskHeadingId = useId();
  const columnsRef = useRef<HTMLDivElement>(null);
  const project = useProject(session.projectId);
  const agentStatuses = useHostAgentStatuses(project?.remoteServerId, project?.location, {
    installedOnly: true,
  });

  // Scroll sync runs outside React: no state, no re-renders while scrolling.
  useEffect(() => {
    const container = columnsRef.current;
    if (!container) return;
    return installScrollSync(container);
  }, []);

  const answers = compareAnswers(session);
  const progress = compareProgress(answers);
  const columns = { "--vc-rt-compare-columns": answers.length } as CSSProperties;
  const answered = progress.answered;
  const total = progress.total;

  return (
    <div className="vc-rt-compare">
      <section className="vc-rt-compare__task" aria-labelledby={taskHeadingId}>
        <h3 id={taskHeadingId} className="vc-rt-task__heading">
          <Trans>Task</Trans>
        </h3>
        <div className="vc-rt-turn__markdown">
          <ItemMarkdown text={session.task} />
        </div>
      </section>
      <div className="vc-rt-compare__bar">
        <p className="vc-rt-compare__progress" role="status">
          <Trans>
            {answered} of {total} answered
          </Trans>
        </p>
        <DebateActions session={session} answered={answered} />
      </div>
      <FailureNotice session={session} />
      <div
        ref={columnsRef}
        className="vc-rt-compare__columns"
        role="list"
        aria-label={t`Answers`}
        style={columns}
      >
        {answers.map((answer) => (
          <CompareColumn
            key={answer.participant.id}
            session={session}
            answer={answer}
            modelLabel={modelLabelOf(answer.participant, agentStatuses)}
          />
        ))}
      </div>
    </div>
  );
}
