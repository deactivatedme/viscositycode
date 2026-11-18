/**
 * ViscosityCode Mission Control: the card model (fork of Poracode).
 *
 * Pure functions that turn what the window already holds — thread rows
 * (host-derived status and attention), Roundtable sessions and bots — into one
 * card per agent, plus the filters, the sort and the "needs you" count. Nothing
 * here reads a store, keys on a provider name, or looks at streaming text: the
 * inputs change on status changes, never on content deltas.
 */
import { getStatusTone } from "@/renderer/components/providers/statusTone";
import type { Thread } from "@/shared/contracts";
import { threadAttentionStatus } from "@/shared/threadAttention";
import type { RoundtableSession } from "../roundtable/types";
import type { BotProfile } from "../bots/api";

/** Finished work stays on the board this long after it ended. */
export const RECENT_FINISHED_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * A card's base state. Working cards refine into thinking / tool / streaming
 * from live runtime items (see `missionActivity.ts`); filters and the sort only
 * use the base state, so streaming never reorders or refilters the board.
 */
export type MissionCardState = "attention" | "error" | "working" | "done" | "idle";

export const MISSION_FILTERS = ["all", "needs", "working", "errors", "done"] as const;
export type MissionFilter = (typeof MISSION_FILTERS)[number];

export function isMissionFilter(value: unknown): value is MissionFilter {
  return (MISSION_FILTERS as readonly unknown[]).includes(value);
}

export type MissionAttentionKind = "approval" | "reply";

interface MissionCardBase {
  /** Unique across kinds: "thread:<id>", "roundtable:<id>", "bot:<id>". */
  key: string;
  state: MissionCardState;
  title: string;
  projectId: string | undefined;
  /** Newest activity (ms), for the sort. */
  activityAt: number;
  /** Start of the run in progress (ms), for the elapsed timer. */
  startedAt: number | undefined;
  /** When the last run ended (ms), for "finished … ago". */
  endedAt: number | undefined;
  /** A Stop press would interrupt something. */
  canStop: boolean;
}

export interface ThreadMissionCard extends MissionCardBase {
  kind: "thread";
  threadId: string;
  agentKind: string;
  presentation: "gui" | "terminal";
  /** Set for paired-host threads (that host keeps its own account pools). */
  remoteServerId: string | undefined;
  attentionKind: MissionAttentionKind | undefined;
  errorText: string | undefined;
}

export interface RoundtableMissionCard extends MissionCardBase {
  kind: "roundtable";
  sessionId: string;
  status: RoundtableSession["status"];
  /** The participant thread waiting for the user, when one is. */
  reviewThreadId: string | undefined;
}

export interface BotMissionCard extends MissionCardBase {
  kind: "bot";
  botId: string;
  brain: "agent" | "xai";
  chatId: string;
  /** Agent bots: the chat thread (status, Stop, Review request). */
  threadId: string | undefined;
  agentKind: string | undefined;
  presentation: "gui" | "terminal" | undefined;
  remoteServerId: string | undefined;
  attentionKind: MissionAttentionKind | undefined;
  errorText: string | undefined;
}

export type MissionCard = ThreadMissionCard | RoundtableMissionCard | BotMissionCard;

export type MissionThread = Pick<
  Thread,
  | "id"
  | "projectId"
  | "title"
  | "agentKind"
  | "status"
  | "archived"
  | "done"
  | "createdAt"
  | "updatedAt"
> &
  Partial<
    Pick<
      Thread,
      | "attention"
      | "presentationMode"
      | "remoteServerId"
      | "activeTurnStartedAt"
      | "lastTurnStartedAt"
      | "lastTurnEndedAt"
      | "errorMessage"
      | "interruptedTurn"
    >
  >;

export type MissionSession = Pick<
  RoundtableSession,
  "id" | "title" | "projectId" | "status" | "turns" | "threadIds" | "createdAt" | "updatedAt"
>;

export type MissionBot = Pick<BotProfile, "id" | "label" | "brain" | "chatId" | "projectId">;

export interface MissionApiChat {
  updatedAt: number;
  messages: ReadonlyArray<{ role: "user" | "assistant"; status?: "failed" | "stopped" }>;
}

export interface MissionInputs {
  threads: readonly MissionThread[];
  sessions: readonly MissionSession[];
  bots: readonly MissionBot[];
  /** API bot chats by chat id. */
  apiChats: Readonly<Record<string, MissionApiChat | undefined>>;
  /** API bot chats with a reply streaming. */
  runningApiChats: Readonly<Record<string, boolean | undefined>>;
  now: number;
  recentWindowMs?: number;
}

function parseTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : undefined;
}

function firstLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || undefined;
}

interface ThreadStateResult {
  state: MissionCardState;
  attentionKind: MissionAttentionKind | undefined;
}

/**
 * A thread's card state, or null when it does not belong on the board:
 * archived, never ran, or finished longer ago than the recent window. Live
 * turns, waits for the user and errors always show (errors stay until the
 * user acts, like the status bar's error count); the tone rules are the
 * sidebar's (`getStatusTone`).
 */
export function threadMissionState(
  thread: MissionThread,
  now: number,
  recentWindowMs: number = RECENT_FINISHED_WINDOW_MS,
): ThreadStateResult | null {
  if (thread.archived) return null;
  const tone = getStatusTone(thread);
  if (tone === "attention") {
    const display = threadAttentionStatus(thread.status, thread.attention);
    return {
      state: "attention",
      attentionKind: display === "needs_reply" ? "reply" : "approval",
    };
  }
  if (tone === "error") return { state: "error", attentionKind: undefined };
  if (tone === "working") return { state: "working", attentionKind: undefined };
  const endedAt = parseTime(thread.lastTurnEndedAt);
  if (endedAt === undefined || now - endedAt > recentWindowMs) return null;
  // A turn the agent's failure cut short reads as an error while it is recent.
  if (thread.interruptedTurn === "error" && !thread.done) {
    return { state: "error", attentionKind: undefined };
  }
  return { state: "done", attentionKind: undefined };
}

function threadTiming(thread: MissionThread) {
  const startedAt = parseTime(thread.activeTurnStartedAt);
  const endedAt = parseTime(thread.lastTurnEndedAt);
  const activityAt =
    startedAt ?? endedAt ?? parseTime(thread.updatedAt) ?? parseTime(thread.createdAt) ?? 0;
  return { startedAt, endedAt, activityAt };
}

/** The structured runtime can stop a working turn; terminal threads stop in their own terminal. */
function threadCanStop(thread: MissionThread): boolean {
  return thread.status === "working" && thread.presentationMode !== "terminal";
}

function threadCard(thread: MissionThread, result: ThreadStateResult): ThreadMissionCard {
  const timing = threadTiming(thread);
  return {
    kind: "thread",
    key: `thread:${thread.id}`,
    threadId: thread.id,
    agentKind: thread.agentKind,
    title: thread.title,
    projectId: thread.projectId,
    presentation: thread.presentationMode === "terminal" ? "terminal" : "gui",
    remoteServerId: thread.remoteServerId,
    state: result.state,
    attentionKind: result.attentionKind,
    errorText: result.state === "error" ? firstLine(thread.errorMessage) : undefined,
    startedAt:
      result.state === "working" || result.state === "attention" ? timing.startedAt : undefined,
    endedAt: timing.endedAt,
    activityAt: timing.activityAt,
    canStop: threadCanStop(thread),
  };
}

function waitingTurn(session: MissionSession) {
  for (let index = session.turns.length - 1; index >= 0; index -= 1) {
    const turn = session.turns[index]!;
    if (turn.status === "waiting-approval") return turn;
  }
  return undefined;
}

function runningTurn(session: MissionSession) {
  for (let index = session.turns.length - 1; index >= 0; index -= 1) {
    const turn = session.turns[index]!;
    if (turn.status === "running" || turn.status === "waiting-approval") return turn;
  }
  return undefined;
}

function isLiveSession(status: RoundtableSession["status"]): boolean {
  return status === "running" || status === "paused";
}

/** Participant thread id → id of the one session that owns it on the board. */
export type ParticipantOwners = ReadonlyMap<string, string>;

/** Whether `candidate` takes a shared participant thread from `current`. */
function ownsBefore(candidate: MissionSession, current: MissionSession): boolean {
  const candidateLive = isLiveSession(candidate.status);
  if (candidateLive !== isLiveSession(current.status)) return candidateLive;
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt;
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return candidate.id > current.id;
}

/**
 * Which session owns each participant thread. One thread can belong to
 * several Roundtables (a finished comparison and the debate seeded from it
 * continue in the same threads): the live session owns it, else the most
 * recent one, so the thread counts once and points at the session that
 * drives it now. Drafts never own threads.
 */
export function participantOwners(sessions: readonly MissionSession[]): ParticipantOwners {
  const winners = new Map<string, MissionSession>();
  for (const session of sessions) {
    if (session.status === "draft") continue;
    for (const threadId of Object.values(session.threadIds)) {
      const current = winners.get(threadId);
      if (!current || ownsBefore(session, current)) winners.set(threadId, session);
    }
  }
  return new Map([...winners].map(([threadId, session]) => [threadId, session.id]));
}

function ownsThread(
  session: MissionSession,
  threadId: string | undefined,
  owners: ParticipantOwners,
): boolean {
  return threadId === undefined || owners.get(threadId) === session.id;
}

/** The session's newest waiting turn whose participant thread it owns. */
function ownedWaitingTurn(session: MissionSession, owners: ParticipantOwners) {
  const turn = waitingTurn(session);
  return turn && ownsThread(session, session.threadIds[turn.participantId], owners)
    ? turn
    : undefined;
}

/** A participant thread the session owns that waits for the user, if any. */
function waitingParticipantThread(
  session: MissionSession,
  threadsById: ReadonlyMap<string, MissionThread>,
  owners: ParticipantOwners,
): string | undefined {
  for (const threadId of Object.values(session.threadIds)) {
    if (!ownsThread(session, threadId, owners)) continue;
    const thread = threadsById.get(threadId);
    if (thread && !thread.archived && getStatusTone(thread) === "attention") return threadId;
  }
  return undefined;
}

/**
 * A Roundtable's card state, or null when it is a draft or finished long ago.
 * A live Roundtable needs the user while a turn waits for an approval or an
 * answer, or while one of its participant threads does (the engine marks the
 * turn a moment later).
 */
export function roundtableMissionState(
  session: MissionSession,
  now: number,
  recentWindowMs: number = RECENT_FINISHED_WINDOW_MS,
  waitingThreadId?: string,
  owners?: ParticipantOwners,
): MissionCardState | null {
  switch (session.status) {
    case "running":
    case "paused": {
      const waiting = owners ? ownedWaitingTurn(session, owners) : waitingTurn(session);
      if (waiting || waitingThreadId) return "attention";
      // A paused Roundtable waits for Resume, not for an answer.
      return session.status === "running" ? "working" : "idle";
    }
    case "draft":
      return null;
    case "failed":
    case "done":
    case "stopped":
      if (now - session.updatedAt > recentWindowMs) return null;
      return session.status === "failed" ? "error" : "done";
  }
}

function roundtableCard(
  session: MissionSession,
  threadsById: ReadonlyMap<string, MissionThread>,
  owners: ParticipantOwners,
  now: number,
  recentWindowMs: number,
): RoundtableMissionCard | null {
  const live = isLiveSession(session.status);
  const waitingThreadId = live ? waitingParticipantThread(session, threadsById, owners) : undefined;
  const state = roundtableMissionState(session, now, recentWindowMs, waitingThreadId, owners);
  if (!state) return null;
  const waiting = ownedWaitingTurn(session, owners);
  const active = runningTurn(session);
  return {
    kind: "roundtable",
    key: `roundtable:${session.id}`,
    sessionId: session.id,
    status: session.status,
    title: session.title,
    projectId: session.projectId,
    state,
    reviewThreadId:
      (waiting ? session.threadIds[waiting.participantId] : undefined) ?? waitingThreadId,
    startedAt: session.status === "running" ? (active?.startedAt ?? session.createdAt) : undefined,
    endedAt: live ? undefined : session.updatedAt,
    activityAt: session.updatedAt,
    canStop: live,
  };
}

function apiBotState(
  chat: MissionApiChat | undefined,
  running: boolean,
  now: number,
  recentWindowMs: number,
): MissionCardState {
  if (running) return "working";
  const last = chat?.messages.at(-1);
  if (last?.role === "assistant" && last.status === "failed") return "error";
  if (chat && chat.messages.length > 0 && now - chat.updatedAt <= recentWindowMs) return "done";
  return "idle";
}

function botCard(
  bot: MissionBot,
  chatId: string,
  inputs: MissionInputs,
  threadsById: ReadonlyMap<string, MissionThread>,
  recentWindowMs: number,
): BotMissionCard {
  const base = {
    kind: "bot" as const,
    key: `bot:${bot.id}`,
    botId: bot.id,
    chatId,
    title: bot.label,
    projectId: bot.projectId,
  };
  if (bot.brain.kind === "agent") {
    const thread = threadsById.get(chatId);
    const result = thread ? threadMissionState(thread, inputs.now, recentWindowMs) : null;
    const timing = thread ? threadTiming(thread) : undefined;
    const state = result?.state ?? "idle";
    return {
      ...base,
      brain: "agent",
      threadId: thread ? chatId : undefined,
      agentKind: bot.brain.agentKind,
      presentation: thread?.presentationMode === "terminal" ? "terminal" : "gui",
      remoteServerId: thread?.remoteServerId,
      state,
      attentionKind: result?.attentionKind,
      errorText: state === "error" ? firstLine(thread?.errorMessage) : undefined,
      startedAt: state === "working" || state === "attention" ? timing?.startedAt : undefined,
      endedAt: timing?.endedAt,
      activityAt: timing?.activityAt ?? 0,
      canStop: thread ? threadCanStop(thread) : false,
    };
  }
  const chat = inputs.apiChats[chatId];
  const running = inputs.runningApiChats[chatId] === true;
  const state = apiBotState(chat, running, inputs.now, recentWindowMs);
  return {
    ...base,
    brain: "xai",
    threadId: undefined,
    agentKind: undefined,
    presentation: undefined,
    remoteServerId: undefined,
    state,
    attentionKind: undefined,
    errorText: undefined,
    startedAt: running ? chat?.updatedAt : undefined,
    endedAt: running ? undefined : chat?.updatedAt,
    activityAt: chat?.updatedAt ?? 0,
    canStop: running,
  };
}

/**
 * Every card on the board, unsorted: active or recently finished threads in
 * all projects, running (or recently finished) Roundtables, and every bot
 * with a chat. An agent bot's chat thread shows once, as the bot's card. A
 * live Roundtable stands for its participant threads; after it ends, its
 * finished participants stay under its card and only the ones the user keeps
 * using (working, waiting, failed) show on their own. A thread shared by
 * several Roundtables belongs to its owner only (see `participantOwners`).
 */
export function buildMissionCards(inputs: MissionInputs): MissionCard[] {
  const recentWindowMs = inputs.recentWindowMs ?? RECENT_FINISHED_WINDOW_MS;
  const threadsById = new Map(inputs.threads.map((thread) => [thread.id, thread]));
  const cards: MissionCard[] = [];
  const botThreadIds = new Set<string>();
  for (const bot of inputs.bots) {
    if (!bot.chatId) continue;
    if (bot.brain.kind === "agent") botThreadIds.add(bot.chatId);
    cards.push(botCard(bot, bot.chatId, inputs, threadsById, recentWindowMs));
  }
  const owners = participantOwners(inputs.sessions);
  const liveParticipants = new Set<string>();
  const endedParticipants = new Set<string>();
  for (const session of inputs.sessions) {
    const card = roundtableCard(session, threadsById, owners, inputs.now, recentWindowMs);
    if (!card) continue;
    cards.push(card);
    const owned = isLiveSession(session.status) ? liveParticipants : endedParticipants;
    for (const threadId of Object.values(session.threadIds)) {
      if (ownsThread(session, threadId, owners)) owned.add(threadId);
    }
  }
  for (const thread of inputs.threads) {
    if (botThreadIds.has(thread.id) || liveParticipants.has(thread.id)) continue;
    const result = threadMissionState(thread, inputs.now, recentWindowMs);
    if (!result) continue;
    if (result.state === "done" && endedParticipants.has(thread.id)) continue;
    cards.push(threadCard(thread, result));
  }
  return cards;
}

const STATE_RANK: Readonly<Record<MissionCardState, number>> = {
  attention: 0,
  error: 1,
  working: 2,
  done: 3,
  idle: 4,
};

/** Needs-you first, then errors, running work, finished; newest first within each. */
export function compareMissionCards(a: MissionCard, b: MissionCard): number {
  return (
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    b.activityAt - a.activityAt ||
    a.title.localeCompare(b.title) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

export function sortMissionCards(cards: readonly MissionCard[]): MissionCard[] {
  return cards.toSorted(compareMissionCards);
}

export function cardMatchesFilter(
  card: Pick<MissionCard, "state">,
  filter: MissionFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs":
      return card.state === "attention";
    case "working":
      return card.state === "working";
    case "errors":
      return card.state === "error";
    case "done":
      return card.state === "done";
  }
}

export type MissionFilterCounts = Readonly<Record<MissionFilter, number>>;

export function countMissionFilters(
  cards: readonly Pick<MissionCard, "state">[],
): MissionFilterCounts {
  const counts: Record<MissionFilter, number> = {
    all: 0,
    needs: 0,
    working: 0,
    errors: 0,
    done: 0,
  };
  for (const card of cards) {
    for (const filter of MISSION_FILTERS) {
      if (cardMatchesFilter(card, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

export type MissionCountInputs = Pick<MissionInputs, "threads" | "sessions" | "bots">;

/**
 * How many cards are in "Needs you": threads, bots and Roundtables waiting
 * for an approval or an answer, each counted once (a Roundtable stands for
 * its waiting participant). Waits never age out, so this needs no clock and
 * the status bar matches the board.
 */
export function countNeedsYou(inputs: MissionCountInputs): number {
  const cards = buildMissionCards({
    ...inputs,
    apiChats: {},
    runningApiChats: {},
    now: 0,
    recentWindowMs: Number.POSITIVE_INFINITY,
  });
  let count = 0;
  for (const card of cards) if (card.state === "attention") count += 1;
  return count;
}
