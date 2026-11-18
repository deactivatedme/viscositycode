/**
 * ViscosityCode: pure agent-state derivation for the Step 4 effects.
 *
 * Everything here reads provider-agnostic data the window already holds
 * (ARCHITECTURE_NOTES §3): `thread.status` / `thread.attention`, canonical
 * runtime item types and states, and open runtime requests. Nothing keys on an
 * agent kind or a vendor tool name.
 */
import {
  isThreadTurnActive,
  type AppView,
  type CanonicalItemType,
  type Thread,
  type ThreadAttention,
  type ThreadStatus,
} from "@/shared/contracts";
import { threadAttentionStatus } from "@/shared/threadAttention";
import type { EffectsSettings } from "@/renderer/fx/fxSettingsStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";

/** Visual state written to `data-vc-fx-state`. */
export const FX_AGENT_STATES = [
  "thinking",
  "tool",
  "streaming",
  "attention",
  "error",
  "working",
  "idle",
] as const;
export type FxAgentState = (typeof FX_AGENT_STATES)[number];

/** One-shot transition written to `data-vc-fx-flash`. */
export type FxFlash = "error" | "done";

export function isFxAgentState(value: unknown): value is FxAgentState {
  return (FX_AGENT_STATES as readonly unknown[]).includes(value);
}

/** Canonical item types that represent a tool the agent is running. */
export const TOOL_ITEM_TYPES: ReadonlySet<CanonicalItemType> = new Set<CanonicalItemType>([
  "tool_call",
  "mcp_tool_call",
  "dynamic_tool_call",
  "command_execution",
  "file_change",
  "web_search",
  "image_view",
]);

/** Upper bound on items inspected per derivation; a turn rarely holds more open work. */
export const MAX_TURN_SCAN = 400;

export interface ThreadActivity {
  /** Tool-like items in the current turn that have not completed. */
  readonly runningTools: number;
  /** A reasoning item is open and no assistant text has started after it. */
  readonly thinking: boolean;
  /** Newest assistant message of the current turn while it is still open. */
  readonly streamItemId: string | null;
}

export const IDLE_ACTIVITY: ThreadActivity = Object.freeze({
  runningTools: 0,
  thinking: false,
  streamItemId: null,
});

/**
 * Scan the current turn (newest item back to the latest user message) for
 * running tools, open reasoning and the open assistant message.
 */
export function deriveThreadActivity(
  ids: readonly string[] | undefined,
  items: Readonly<Record<string, RuntimeChatItem>> | undefined,
  maxScan: number = MAX_TURN_SCAN,
): ThreadActivity {
  if (!ids || !items || ids.length === 0) return IDLE_ACTIVITY;
  let runningTools = 0;
  let thinking = false;
  let streamItemId: string | null = null;
  let seenAssistant = false;
  const stop = Math.max(0, ids.length - maxScan);
  for (let index = ids.length - 1; index >= stop; index -= 1) {
    const item = items[ids[index]!];
    if (!item) continue;
    if (item.type === "user_message") break;
    const open = item.state !== "completed";
    if (item.type === "assistant_message") {
      if (!seenAssistant) {
        seenAssistant = true;
        if (open) streamItemId = item.id;
      }
      continue;
    }
    if (!open) continue;
    if (TOOL_ITEM_TYPES.has(item.type)) runningTools += 1;
    else if (item.type === "reasoning" && !seenAssistant) thinking = true;
  }
  if (runningTools === 0 && !thinking && streamItemId === null) return IDLE_ACTIVITY;
  return { runningTools, thinking, streamItemId };
}

export type FxPresentation = "terminal" | "gui";

/** Terminal (PTY) threads only expose status and attention. */
export function resolveFxPresentation(thread: Pick<Thread, "presentationMode">): FxPresentation {
  return thread.presentationMode === "terminal" ? "terminal" : "gui";
}

export interface FxStateInput {
  readonly status: ThreadStatus;
  readonly attention?: ThreadAttention | undefined;
  readonly presentation: FxPresentation;
  /** Open approval / user-input requests (chat threads only). */
  readonly openRequests: number;
  readonly activity: ThreadActivity;
  /** The sampler measured assistant text growing. */
  readonly streaming: boolean;
}

/** Priority: attention, error, tool, thinking, streaming, working, idle. */
export function deriveFxState(input: FxStateInput): FxAgentState {
  const display = threadAttentionStatus(input.status, input.attention);
  if (display === "error") return "error";
  if (display === "needs_approval" || display === "needs_reply") return "attention";
  if (input.presentation === "terminal") {
    return isThreadTurnActive(input.status) ? "working" : "idle";
  }
  if (input.openRequests > 0) return "attention";
  if (!isThreadTurnActive(input.status)) return "idle";
  if (input.activity.runningTools > 0) return "tool";
  if (input.activity.thinking) return "thinking";
  if (input.streaming) return "streaming";
  return "working";
}

export interface TurnSnapshot {
  readonly status: ThreadStatus;
  readonly attention?: ThreadAttention | undefined;
  readonly interruptedTurn?: Thread["interruptedTurn"];
}

/**
 * The one-shot effect a status change deserves: `error` when the thread enters
 * an error (or its turn is cut off by one), `done` when an active turn settles
 * to idle/finished without error or interruption. No previous snapshot (a
 * thread just came into view) never flashes.
 */
export function detectTurnTransition(
  previous: TurnSnapshot | undefined,
  next: TurnSnapshot,
): FxFlash | null {
  if (!previous) return null;
  const before = threadAttentionStatus(previous.status, previous.attention);
  const after = threadAttentionStatus(next.status, next.attention);
  if (after === "error" && before !== "error") return "error";
  if (next.interruptedTurn === "error" && previous.interruptedTurn !== "error") return "error";
  if (
    isThreadTurnActive(previous.status) &&
    (next.status === "idle" || next.status === "finished") &&
    !next.interruptedTurn
  ) {
    return "done";
  }
  return null;
}

/**
 * The `data-vc-fx-state` value to write, or null when that effect is switched off.
 * Thinking, tool and streaming only occur inside an active turn, so with their
 * own effect off they fall back to "working": the pane keeps its steady turn
 * edge instead of flickering off and on as tools start and stop.
 */
export function fxStateAttribute(state: FxAgentState, effects: EffectsSettings): string | null {
  if (!effects.enabled) return null;
  switch (state) {
    case "thinking":
      return effects.thinkingGlow ? state : "working";
    case "tool":
      return effects.toolIndicator ? state : "working";
    case "streaming":
      return effects.streamingEnergy ? state : "working";
    case "attention":
      return effects.attentionColor ? state : null;
    case "error":
      return effects.errorFlash ? state : null;
    case "working":
    case "idle":
      return state;
  }
}

/** The `data-vc-fx-flash` value to write, or null when that effect is switched off. */
export function fxFlashAttribute(flash: FxFlash | null, effects: EffectsSettings): string | null {
  if (!flash || !effects.enabled) return null;
  if (flash === "error") return effects.errorFlash ? flash : null;
  return effects.completionAnimation ? flash : null;
}

const NO_IDS: readonly string[] = [];

export function selectPaneThreadIds(view: AppView): readonly string[] {
  return view.kind === "thread" ? view.panes : NO_IDS;
}

const turnActiveIdsCache = new WeakMap<readonly Thread[], readonly string[]>();

/** Turn-active thread ids, memoized per `threads` array identity. */
export function getTurnActiveThreadIds(threads: readonly Thread[]): readonly string[] {
  let ids = turnActiveIdsCache.get(threads);
  if (!ids) {
    const active: string[] = [];
    for (const thread of threads) {
      if (!thread.archived && isThreadTurnActive(thread.status)) active.push(thread.id);
    }
    ids = active.length === 0 ? NO_IDS : active;
    turnActiveIdsCache.set(threads, ids);
  }
  return ids;
}

/**
 * Threads the monitor follows: those shown in panes or open as tabs (visible
 * effects), plus every turn-active thread (the "tools running" count).
 * Order: panes, tabs, then the rest; no duplicates.
 */
export function collectTrackedThreadIds(
  paneIds: readonly string[],
  tabIds: readonly string[],
  activeIds: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [paneIds, tabIds, activeIds]) {
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Inputs whose change requires re-deriving a thread; streaming deltas are not among them. */
export interface ThreadSignatureInput {
  readonly status: ThreadStatus;
  readonly attention?: ThreadAttention | undefined;
  readonly interruptedTurn?: Thread["interruptedTurn"];
  readonly presentation: FxPresentation;
  readonly structuralVersion: number;
  readonly itemCount: number;
  readonly openRequests: number;
}

/** A small primitive key; equal keys mean the derived state cannot have changed. */
export function threadSignature(input: ThreadSignatureInput): string {
  return [
    input.status,
    input.attention ?? "",
    input.interruptedTurn ?? "",
    input.presentation,
    input.structuralVersion,
    input.itemCount,
    input.openRequests,
  ].join("|");
}
