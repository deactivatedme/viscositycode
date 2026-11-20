/**
 * ViscosityCode: pure agent-activity derivation: the "N tools running" count
 * (./monitor.ts) and the shared `data-vc-fx-state` values that Mission Control
 * and Roundtable write on their cards and chips.
 *
 * Everything here reads provider-agnostic data the window already holds
 * (ARCHITECTURE_NOTES §3): `thread.status`, canonical runtime item types and
 * states. Nothing keys on an agent kind or a vendor tool name.
 */
import { isThreadTurnActive, type CanonicalItemType, type Thread } from "@/shared/contracts";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";

/** Visual state written to `data-vc-fx-state` (agentActivity.css, Mission Control, Roundtable). */
export type FxAgentState =
  | "thinking"
  | "tool"
  | "streaming"
  | "attention"
  | "error"
  | "working"
  | "idle";

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

const NO_IDS: readonly string[] = [];

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
