/**
 * ViscosityCode Mission Control: what a chat thread is doing right now (fork
 * of Poracode) — its refined live state (tool / thinking / streaming) and a
 * one-line "current step" (the running tool, else the newest assistant line).
 *
 * This is hot data: assistant text grows on every content delta. So it is
 * read OUTSIDE React by a tracker that samples the store about once a second,
 * only for the thread cards currently mounted, only while the window is
 * visible, and notifies a card only when its line actually changed. Only
 * canonical item types and payload fields are read — never an agent kind or a
 * vendor tool name — and threads whose runtime items are not loaded simply
 * show no step.
 */
import { useSyncExternalStore } from "react";
import { assistantDisplayText } from "@/shared/assistantMessageText";
import { TOOL_ITEM_TYPES } from "@/renderer/viscosity/agentActivity/derive";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";

/** Items inspected per thread and sample; the current turn rarely holds more. */
export const MAX_ACTIVITY_SCAN = 300;
/** Longest step line kept (the card truncates visually anyway). */
export const MAX_STEP_LENGTH = 160;
export const ACTIVITY_SAMPLE_MS = 1000;
/** Last-known activity kept for threads no card follows right now. */
export const MAX_RETIRED_ACTIVITY = 64;

export type MissionLiveState = "tool" | "thinking" | "streaming";

export interface MissionStep {
  kind: "tool" | "text";
  text: string;
}

export interface MissionActivity {
  /** Refinement of a working chat thread; null when nothing specific is open. */
  live: MissionLiveState | null;
  step: MissionStep | null;
}

export const NO_ACTIVITY: MissionActivity = Object.freeze({ live: null, step: null });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clip(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > MAX_STEP_LENGTH ? `${single.slice(0, MAX_STEP_LENGTH - 1)}…` : single;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** A tool item's short label from its canonical payload (title, name, command, path, query). */
export function toolStepLabel(item: Pick<RuntimeChatItem, "type" | "payload">): string | null {
  const payload = isRecord(item.payload) ? item.payload : undefined;
  if (!payload) return null;
  let label: string | undefined;
  switch (item.type) {
    case "command_execution":
      label = readString(payload, "command")?.split("\n")[0];
      break;
    case "file_change": {
      const path = readString(payload, "path");
      label = path ? basename(path) : undefined;
      break;
    }
    case "web_search":
      label = readString(payload, "query") ?? readString(payload, "url");
      break;
    default: {
      const progress = isRecord(payload.progress) ? payload.progress : undefined;
      label =
        readString(payload, "title") ??
        readString(payload, "name") ??
        (progress ? readString(progress, "description") : undefined);
    }
  }
  return label ? clip(label) : null;
}

/** The last non-empty line of an assistant message, without list/heading/quote markers. */
export function lastTextLine(text: string): string | null {
  let end = text.length;
  while (end > 0) {
    const start = text.lastIndexOf("\n", end - 1);
    const line = text
      .slice(start + 1, end)
      .replace(/^[\s#>*\-+`|]+/, "")
      .trim();
    if (line && !/^`{3,}/.test(line)) return clip(line);
    if (start < 0) break;
    end = start;
  }
  return null;
}

/**
 * Scan the current turn (newest item back to the latest user message):
 * running tools win, then open reasoning, then an open assistant message.
 * The step is the newest running tool, else the newest assistant line, else
 * the newest finished tool. Sub-agent children are skipped; their parent
 * tool row stands for them.
 */
export function deriveMissionActivity(
  ids: readonly string[] | undefined,
  items: Readonly<Record<string, RuntimeChatItem>> | undefined,
  maxScan: number = MAX_ACTIVITY_SCAN,
): MissionActivity {
  if (!ids || !items || ids.length === 0) return NO_ACTIVITY;
  let openTool: RuntimeChatItem | undefined;
  let lastTool: RuntimeChatItem | undefined;
  let assistant: RuntimeChatItem | undefined;
  let thinking = false;
  const stop = Math.max(0, ids.length - maxScan);
  for (let index = ids.length - 1; index >= stop; index -= 1) {
    const item = items[ids[index]!];
    if (!item || item.parentItemId) continue;
    if (item.type === "user_message") break;
    const open = item.state !== "completed";
    if (item.type === "assistant_message") {
      assistant ??= item;
      continue;
    }
    if (TOOL_ITEM_TYPES.has(item.type)) {
      lastTool ??= item;
      if (open) openTool ??= item;
      continue;
    }
    if (item.type === "reasoning" && open && !assistant) thinking = true;
  }
  const live: MissionLiveState | null = openTool
    ? "tool"
    : thinking
      ? "thinking"
      : assistant && assistant.state !== "completed"
        ? "streaming"
        : null;
  let step: MissionStep | null = null;
  const toolLabel = openTool ? toolStepLabel(openTool) : null;
  if (toolLabel) step = { kind: "tool", text: toolLabel };
  if (!step && assistant) {
    const line = lastTextLine(assistantDisplayText(assistant));
    if (line) step = { kind: "text", text: line };
  }
  if (!step && lastTool) {
    const label = toolStepLabel(lastTool);
    if (label) step = { kind: "tool", text: label };
  }
  if (live === null && step === null) return NO_ACTIVITY;
  return { live, step };
}

export function sameActivity(a: MissionActivity, b: MissionActivity): boolean {
  return a.live === b.live && a.step?.kind === b.step?.kind && a.step?.text === b.step?.text;
}

/** What the tracker reads for one thread. */
export interface ThreadActivitySource {
  ids: readonly string[] | undefined;
  items: Readonly<Record<string, RuntimeChatItem>> | undefined;
  /** Bumps on structural changes, never on content deltas. */
  structuralVersion: number;
  /** A live turn: text can grow without a structural change, so sample it anyway. */
  turnActive: boolean;
}

export interface MissionActivityTrackerOptions {
  read: (threadId: string) => ThreadActivitySource | undefined;
  intervalMs?: number;
  /** True while sampling should pause (window hidden). */
  isPaused?: () => boolean;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface MissionActivityTracker {
  subscribe(threadId: string, listener: () => void): () => void;
  /** Current activity; the last known one for a thread no card follows right now. */
  get(threadId: string): MissionActivity;
  /** Sample every followed thread now. */
  sample(): void;
  /** Followed thread ids (tests, dev hook). */
  followed(): string[];
}

interface Entry {
  activity: MissionActivity;
  version: number;
  listeners: Set<() => void>;
}

export function createMissionActivityTracker(
  options: MissionActivityTrackerOptions,
): MissionActivityTracker {
  const intervalMs = options.intervalMs ?? ACTIVITY_SAMPLE_MS;
  const startTimer =
    options.setInterval ??
    ((callback: () => void, ms: number) => globalThis.setInterval(callback, ms));
  const stopTimer =
    options.clearInterval ??
    ((handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  const entries = new Map<string, Entry>();
  // A card that re-renders unsubscribes and subscribes again; keeping the
  // last activity object lets the snapshot stay identical across that, so
  // React does not see a change (and re-render) when nothing changed.
  const retired = new Map<string, MissionActivity>();
  let timer: unknown;

  function retire(threadId: string, activity: MissionActivity): void {
    retired.delete(threadId);
    retired.set(threadId, activity);
    if (retired.size > MAX_RETIRED_ACTIVITY) {
      const oldest = retired.keys().next().value;
      if (oldest !== undefined) retired.delete(oldest);
    }
  }

  function compute(threadId: string): { activity: MissionActivity; version: number } {
    const source = options.read(threadId);
    if (!source) return { activity: NO_ACTIVITY, version: -1 };
    return {
      activity: deriveMissionActivity(source.ids, source.items),
      version: source.structuralVersion,
    };
  }

  function sampleOne(threadId: string, entry: Entry): void {
    const source = options.read(threadId);
    const version = source?.structuralVersion ?? -1;
    if (!source?.turnActive && version === entry.version) return;
    const next = source ? deriveMissionActivity(source.ids, source.items) : NO_ACTIVITY;
    entry.version = version;
    if (sameActivity(entry.activity, next)) return;
    entry.activity = next;
    for (const listener of entry.listeners) listener();
  }

  function sample(): void {
    if (options.isPaused?.()) return;
    for (const [threadId, entry] of entries) sampleOne(threadId, entry);
  }

  return {
    subscribe(threadId, listener) {
      let entry = entries.get(threadId);
      if (!entry) {
        const computed = compute(threadId);
        const previous = retired.get(threadId);
        retired.delete(threadId);
        entry = {
          activity:
            previous && sameActivity(previous, computed.activity) ? previous : computed.activity,
          version: computed.version,
          listeners: new Set(),
        };
        entries.set(threadId, entry);
      }
      entry.listeners.add(listener);
      if (timer === undefined) timer = startTimer(sample, intervalMs);
      return () => {
        const current = entries.get(threadId);
        if (!current) return;
        current.listeners.delete(listener);
        if (current.listeners.size === 0) {
          entries.delete(threadId);
          retire(threadId, current.activity);
        }
        if (entries.size === 0 && timer !== undefined) {
          stopTimer(timer);
          timer = undefined;
        }
      };
    },
    get(threadId) {
      return entries.get(threadId)?.activity ?? retired.get(threadId) ?? NO_ACTIVITY;
    },
    sample,
    followed() {
      return [...entries.keys()];
    },
  };
}

function isWindowHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

let sharedTracker: MissionActivityTracker | undefined;

/** The app's tracker, reading `useAppStore` (created on first use). */
export function getMissionActivityTracker(): MissionActivityTracker {
  sharedTracker ??= createMissionActivityTracker({
    read: (threadId) => {
      const state = useAppStore.getState();
      return {
        ids: state.runtimeItemIdsByThread[threadId],
        items: state.runtimeItemsByIdByThread[threadId],
        structuralVersion: state.runtimeStructuralVersionByThread[threadId] ?? 0,
        turnActive: state.runtimeOpenTurnByThread[threadId] === true,
      };
    },
    isPaused: isWindowHidden,
  });
  return sharedTracker;
}

const noopUnsubscribe = () => {};

/** A chat thread's live state and step; NO_ACTIVITY for terminal threads or no thread. */
export function useMissionActivity(threadId: string | undefined): MissionActivity {
  return useSyncExternalStore(
    (listener) =>
      threadId ? getMissionActivityTracker().subscribe(threadId, listener) : noopUnsubscribe,
    () => (threadId ? getMissionActivityTracker().get(threadId) : NO_ACTIVITY),
    () => NO_ACTIVITY,
  );
}
