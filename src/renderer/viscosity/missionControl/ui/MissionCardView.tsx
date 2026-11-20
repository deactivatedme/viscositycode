/**
 * ViscosityCode Mission Control: one agent's card (fork of Poracode).
 *
 * The card carries `data-vc-agent-kind` (its agent's accent edge) and
 * `data-vc-fx-state` (the shared agent-state colours). It re-renders on status
 * changes, at most once a second when its "current step" line changes (read
 * outside React by the activity tracker), and never on streaming deltas; only
 * the running timer leaf ticks every second.
 */
import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import {
  Bot,
  CircleAlert,
  MessageSquareText,
  Square,
  UsersRound,
  Wallet,
  Wrench,
} from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { useAppStore } from "@/renderer/state/appStore";
import { getProjectMap } from "@/renderer/state/useThread";
import type { PoolMemberView } from "@/renderer/viscosity/accountPools/poolModel";
import { useMinuteClock } from "@/renderer/viscosity/accountPools/minuteClock";
import { AGENT_ACCENT_CSS, agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import { openMissionCard, reviewMissionCard, stopMissionCard } from "../missionActions";
import { type MissionActivity, NO_ACTIVITY, useMissionActivity } from "../missionActivity";
import { useSecondClock } from "../missionClock";
import { missionFxState, missionStateLabel, missionTimeLabel } from "../missionLabels";
import type { MissionCard } from "../missionModel";
import type { MissionPoolLookup } from "../missionPools";

const CARD_STYLE = { "--vc-mc-accent": AGENT_ACCENT_CSS } as CSSProperties;

/** The agent kind a card represents (its accent and its account pool), if any. */
export function cardAgentKind(card: MissionCard): string | undefined {
  return card.kind === "thread" ? card.agentKind : undefined;
}

/** The chat thread whose live step the card shows: GUI threads that are mid-turn. */
function liveThreadId(card: MissionCard): string | undefined {
  if (card.state !== "working" && card.state !== "attention") return undefined;
  if (card.kind === "roundtable") return undefined;
  if (card.presentation !== "gui") return undefined;
  return card.threadId;
}

/** Pooled account view for this card; paired-host threads use that host's pools. */
function cardPoolView(card: MissionCard, pools: MissionPoolLookup): PoolMemberView | undefined {
  const agentKind = cardAgentKind(card);
  if (!agentKind || card.kind === "roundtable" || card.remoteServerId) return undefined;
  return pools.get(agentKind);
}

function CardIcon(props: { card: MissionCard; label: string }) {
  const { card } = props;
  if (card.kind === "roundtable") return <UsersRound className="size-4" />;
  const agentKind = cardAgentKind(card);
  return agentKind ? (
    <ProviderIcon kind={agentKind} fallbackLabel={props.label} className="size-4" />
  ) : (
    <Bot className="size-4" />
  );
}

/** Live timer: only this leaf re-renders every second. */
function RunningTime(props: { card: MissionCard }) {
  const { i18n } = useLingui();
  const now = useSecondClock();
  const label = missionTimeLabel(props.card, now, i18n);
  return label ? <span className="vc-mc-card__time">{label}</span> : null;
}

function FinishedTime(props: { card: MissionCard }) {
  const { i18n } = useLingui();
  const now = useMinuteClock();
  const label = missionTimeLabel(props.card, now, i18n);
  return label ? <span className="vc-mc-card__time">{label}</span> : null;
}

function isRunning(card: MissionCard): boolean {
  return card.startedAt !== undefined && (card.state === "working" || card.state === "attention");
}

function PoolAccount(props: { view: PoolMemberView }) {
  const { t } = useLingui();
  const { view } = props;
  const name = view.label;
  const percent = view.percentLeft;
  const text = percent === undefined ? name : t`${name} · ${percent}% left`;
  const label =
    percent === undefined ? t`Account ${name}` : t`Account ${name}, ${percent}% of usage left`;
  return (
    <span className="vc-mc-card__account" data-pool-tone={view.tone} title={label}>
      <Wallet aria-hidden="true" className="size-3 shrink-0" />
      <span aria-hidden="true" className="vc-mc-card__truncate">
        {text}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function StepLine(props: { card: MissionCard; activity: MissionActivity }) {
  const { card, activity } = props;
  const step = activity.step;
  if (step) {
    return (
      <p className="vc-mc-card__step" data-step={step.kind}>
        {step.kind === "tool" ? (
          <Wrench aria-hidden="true" className="size-3 shrink-0" />
        ) : (
          <MessageSquareText aria-hidden="true" className="size-3 shrink-0" />
        )}
        <span className="vc-mc-card__truncate" title={step.text}>
          {step.text}
        </span>
      </p>
    );
  }
  const errorText = card.kind === "roundtable" ? undefined : card.errorText;
  if (card.state === "error" && errorText) {
    return (
      <p className="vc-mc-card__step" data-tone="error">
        <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
        <span className="vc-mc-card__truncate" title={errorText}>
          {errorText}
        </span>
      </p>
    );
  }
  return null;
}

/**
 * Stop stays focusable while the interrupt is pending, and when it goes away
 * (the turn ended) with keyboard focus on it, focus moves to the card's title
 * instead of dropping to the page (where Escape and the arrows stop working).
 */
function StopButton(props: {
  card: MissionCard;
  title: string;
  focusAfter: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useLingui();
  const { card, focusAfter } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [stopping, setStopping] = useState(false);
  // A Work together chat's Stop only interrupts the current replies (`stopMissionCard`).
  const repliesOnly = card.kind === "roundtable" && card.pattern === "open";

  useLayoutEffect(() => {
    const button = buttonRef.current;
    // The card's title renders before its actions, so its ref is already set.
    const title = focusAfter.current;
    // Layout cleanup runs before the button leaves the DOM, while it still has focus.
    return () => {
      if (button && title?.isConnected && document.activeElement === button) {
        title.focus({ preventScroll: true });
      }
    };
  }, [focusAfter]);

  function stop() {
    setStopping(true);
    void stopMissionCard(card).finally(() => setStopping(false));
  }

  return (
    <Button
      ref={buttonRef}
      size="sm"
      variant="danger-soft"
      aria-label={repliesOnly ? t`Stop replies in ${props.title}` : t`Stop ${props.title}`}
      isPending={stopping}
      onPress={stop}
    >
      <Square aria-hidden="true" className="size-3" />
      {repliesOnly ? t`Stop replies` : t`Stop`}
    </Button>
  );
}

export interface MissionCardViewProps {
  card: MissionCard;
  /** Display name for an agent kind (account display names for profiles). */
  agentLabel: (agentKind: string) => string;
  pools: MissionPoolLookup;
  /** Roving tab stop of the grid: the card's title button. */
  isTabStop: boolean;
  onFocusCard: (key: string) => void;
  /** Arrow keys, Home and End on the title button move between cards. */
  onNavigate: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function MissionCardView(props: MissionCardViewProps) {
  const { t, i18n } = useLingui();
  const { card } = props;
  const titleId = useId();
  const stateId = useId();
  const openRef = useRef<HTMLButtonElement>(null);
  const watchedThreadId = liveThreadId(card);
  const watched = useMissionActivity(watchedThreadId);
  const activity = watchedThreadId ? watched : NO_ACTIVITY;
  const projectName = useAppStore((state) =>
    card.projectId ? getProjectMap(state.projects).get(card.projectId)?.name : undefined,
  );

  const agentKind = cardAgentKind(card);
  const agentName = agentKind ? props.agentLabel(agentKind) : undefined;
  const kindLabel = card.kind === "roundtable" ? t`Roundtable` : (agentName ?? t`Agent`);
  const live = card.state === "working" ? activity.live : null;
  const stateLabel = missionStateLabel(card, live, i18n);
  const title = card.title.trim() || t`Untitled`;
  const pool = cardPoolView(card, props.pools);
  const needsYou = card.state === "attention";

  return (
    <li
      aria-labelledby={titleId}
      className="vc-mc-card"
      style={CARD_STYLE}
      data-vc-mc-card={card.key}
      data-vc-mc-kind={card.kind}
      data-vc-mc-state={card.state}
      data-vc-fx-state={missionFxState(card, live)}
      {...agentKindAttribute(agentKind)}
    >
      <div className="vc-mc-card__head">
        <span aria-hidden="true" className="vc-mc-card__icon">
          <CardIcon card={card} label={kindLabel} />
        </span>
        <span className="vc-mc-card__kind">{kindLabel}</span>
        <span id={stateId} className="vc-mc-card__state">
          <span aria-hidden="true" className="vc-mc-card__dot" />
          {stateLabel}
        </span>
      </div>
      <h3 id={titleId} className="vc-mc-card__title">
        {/* The card's keyboard stop: Enter opens it, arrows move to the next card. */}
        <button
          ref={openRef}
          type="button"
          className="vc-mc-card__open"
          title={title}
          tabIndex={props.isTabStop ? 0 : -1}
          aria-describedby={stateId}
          data-vc-mc-focus={card.key}
          onFocus={() => props.onFocusCard(card.key)}
          onKeyDown={props.onNavigate}
          onClick={() => openMissionCard(card)}
        >
          {title}
        </button>
      </h3>
      {projectName ? (
        <p className="vc-mc-card__project">
          <span className="vc-mc-card__truncate">{projectName}</span>
        </p>
      ) : null}
      <StepLine card={card} activity={activity} />
      <div className="vc-mc-card__meta">
        {isRunning(card) ? <RunningTime card={card} /> : <FinishedTime card={card} />}
        {pool ? <PoolAccount view={pool} /> : null}
      </div>
      <div className="vc-mc-card__actions">
        {needsYou ? (
          <Button
            size="sm"
            variant="primary"
            aria-label={t`Review request: ${title}`}
            onPress={() => reviewMissionCard(card)}
          >
            {t`Review request`}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          aria-label={t`Open ${title}`}
          onPress={() => openMissionCard(card)}
        >
          {t`Open`}
        </Button>
        {card.canStop ? <StopButton card={card} title={title} focusAfter={openRef} /> : null}
      </div>
    </li>
  );
}
