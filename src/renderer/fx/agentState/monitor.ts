/**
 * ViscosityCode: the agent-state monitor behind the Step 4 effects.
 *
 * It subscribes to the app store OUTSIDE React and is strictly read-only. Each
 * store change first compares a handful of slice references (streaming deltas
 * only replace the item map, so they return here at once), then a small
 * per-thread signature; a thread is re-derived only when its signature moves.
 * Streaming is measured by a 4 Hz sampler that runs only while a visible chat
 * thread is mid-turn. Results reach the DOM through one rAF-batched applicator.
 */
import { isThreadTurnActive } from "@/shared/contracts";
import type { EffectsSettings } from "@/renderer/fx/fxSettingsStore";
import type { AppStoreState } from "@/renderer/state/appStore";
import { getThreadMap } from "@/renderer/state/useThread";
import {
  collectTrackedThreadIds,
  deriveFxState,
  deriveThreadActivity,
  detectTurnTransition,
  type FxAgentState,
  type FxFlash,
  type FxPresentation,
  fxFlashAttribute,
  fxStateAttribute,
  getTurnActiveThreadIds,
  IDLE_ACTIVITY,
  resolveFxPresentation,
  selectPaneThreadIds,
  type ThreadActivity,
  threadSignature,
  type TurnSnapshot,
} from "./derive";
import { createFxDomApplicator, type FxDomFrame, type FxThreadVisual } from "./domApplicator";
import {
  createStreamRateSampler,
  readAssistantStreamLength,
  STREAM_SAMPLE_INTERVAL_MS,
  STREAMING_MIN_RATE,
  streamEnergyFromRate,
} from "./streamSampler";
import { installTypingGlow } from "./typingGlow";

export const ERROR_FLASH_MS = 1200;
export const DONE_FLASH_MS = 1400;

export type AgentMonitorState = Pick<
  AppStoreState,
  | "threads"
  | "view"
  | "runtimeItemIdsByThread"
  | "runtimeItemsByIdByThread"
  | "runtimeRequestsByThread"
  | "runtimeStructuralVersionByThread"
>;

type Timer = ReturnType<typeof setTimeout>;
type IntervalHandle = ReturnType<typeof setInterval>;

export interface AgentStateMonitorOptions {
  document: Document;
  store: {
    getState(): AgentMonitorState;
    subscribe(
      listener: (state: AgentMonitorState, previous: AgentMonitorState) => void,
    ): () => void;
  };
  tabs: { getIds(): readonly string[]; subscribe(listener: () => void): () => void };
  effects: { get(): EffectsSettings; subscribe(listener: () => void): () => void };
  /** Background energy bus. */
  setEnergy(value: number): void;
  /** Status bar "tools running" count. */
  setToolsRunning(count: number): void;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (handle: Timer) => void;
  setRepeating?: (callback: () => void, ms: number) => IntervalHandle;
  clearRepeating?: (handle: IntervalHandle) => void;
  /** Installs the composer typing glow; returns its uninstall. */
  installTyping?: (doc: Document) => () => void;
}

export interface AgentStateSnapshotEntry {
  threadId: string;
  state: FxAgentState;
  flash: FxFlash | null;
  presentation: FxPresentation;
  runningTools: number;
  thinking: boolean;
  /** Smoothed assistant-text rate, chars/s. */
  streamRate: number;
  energy: number;
  inPane: boolean;
  inTab: boolean;
  simulated: FxAgentState | null;
}

export interface SimulateOptions {
  flash?: FxFlash | null;
  /** Pane energy 0..1 while simulating "streaming". */
  energy?: number;
}

export interface AgentStateMonitor {
  start(): void;
  stop(): void;
  snapshot(): AgentStateSnapshotEntry[];
  /** DOM-only override for screenshots; never touches the store. `null` clears. */
  simulate(threadId: string, state: FxAgentState | null, options?: SimulateOptions): void;
  /** Test hook: run the sampler once. */
  sampleNow(): void;
  /** Test hook: write the DOM now instead of on the next frame. */
  flushDom(): void;
  isSampling(): boolean;
}

interface TrackedThread {
  signature: string;
  snapshot: TurnSnapshot;
  presentation: FxPresentation;
  turnActive: boolean;
  openRequests: number;
  activity: ThreadActivity;
  inPane: boolean;
  inTab: boolean;
  streamRate: number;
  streaming: boolean;
  state: FxAgentState;
  flash: FxFlash | null;
  flashTimer: Timer | null;
}

interface Override {
  state: FxAgentState;
  flash: FxFlash | null;
  energy: number;
}

const NO_IDS: readonly string[] = [];

export function createAgentStateMonitor(options: AgentStateMonitorOptions): AgentStateMonitor {
  const doc = options.document;
  const now = options.now ?? (() => performance.now());
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: Timer) => clearTimeout(handle));
  const setRepeating =
    options.setRepeating ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const clearRepeating =
    options.clearRepeating ?? ((handle: IntervalHandle) => clearInterval(handle));
  const installTyping =
    options.installTyping ??
    ((document: Document) =>
      installTypingGlow({
        document,
        ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
        ...(options.cancelFrame ? { cancelFrame: options.cancelFrame } : {}),
      }));

  const tracked = new Map<string, TrackedThread>();
  const overrides = new Map<string, Override>();
  const sampler = createStreamRateSampler();
  let paneIds: readonly string[] = NO_IDS;
  let tabIds: readonly string[] = NO_IDS;
  let lastState: AgentMonitorState | null = null;
  let samplingHandle: IntervalHandle | null = null;
  let publishedEnergy = 0;
  let uninstallTyping: (() => void) | null = null;
  let unsubscribers: (() => void)[] = [];
  let running = false;

  const applicator = createFxDomApplicator({
    document: doc,
    readFrame,
    ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
    ...(options.cancelFrame ? { cancelFrame: options.cancelFrame } : {}),
  });

  function visualFor(
    state: FxAgentState,
    flash: FxFlash | null,
    energy: number,
    effects: EffectsSettings,
  ): FxThreadVisual {
    const stateAttribute = fxStateAttribute(state, effects);
    return {
      state: stateAttribute,
      flash: fxFlashAttribute(flash, effects),
      energy: stateAttribute === "streaming" ? energy : null,
    };
  }

  function readFrame(): FxDomFrame {
    const effects = options.effects.get();
    const threads = new Map<string, FxThreadVisual>();
    if (effects.enabled) {
      for (const [id, entry] of tracked) {
        if (!entry.inPane && !entry.inTab) continue;
        const override = overrides.get(id);
        threads.set(
          id,
          override
            ? visualFor(override.state, override.flash, override.energy, effects)
            : visualFor(entry.state, entry.flash, streamEnergyFromRate(entry.streamRate), effects),
        );
      }
      for (const [id, override] of overrides) {
        if (!threads.has(id)) {
          threads.set(id, visualFor(override.state, override.flash, override.energy, effects));
        }
      }
    }
    return { threads, paneThreadIds: paneIds };
  }

  function publishEnergy(value: number): void {
    const effects = options.effects.get();
    const next = effects.enabled && effects.streamingEnergy ? value : 0;
    if (Math.abs(next - publishedEnergy) < 0.005 && !(next === 0 && publishedEnergy !== 0)) return;
    publishedEnergy = next;
    options.setEnergy(next);
  }

  function combinedPaneEnergy(): number {
    let rate = 0;
    for (const entry of tracked.values()) {
      if (entry.inPane && entry.streaming) rate += entry.streamRate;
    }
    let simulated = 0;
    for (const override of overrides.values()) {
      if (override.state === "streaming") simulated = Math.max(simulated, override.energy);
    }
    return Math.max(streamEnergyFromRate(rate), simulated);
  }

  function clearFlash(entry: TrackedThread): void {
    if (entry.flashTimer !== null) clearTimer(entry.flashTimer);
    entry.flashTimer = null;
    entry.flash = null;
  }

  function startFlash(entry: TrackedThread, flash: FxFlash): void {
    clearFlash(entry);
    entry.flash = flash;
    entry.flashTimer = setTimer(
      () => {
        entry.flashTimer = null;
        entry.flash = null;
        applicator.schedule();
      },
      flash === "error" ? ERROR_FLASH_MS : DONE_FLASH_MS,
    );
  }

  function forget(id: string, entry: TrackedThread): void {
    clearFlash(entry);
    sampler.forget(id);
    tracked.delete(id);
  }

  /** Recompute every tracked thread's visual state and the derived outputs. */
  function refreshStates(): boolean {
    const changed = computeStates();
    updateSampling();
    return changed;
  }

  function computeStates(): boolean {
    let changed = false;
    let tools = 0;
    for (const entry of tracked.values()) {
      const state = deriveFxState({
        status: entry.snapshot.status,
        attention: entry.snapshot.attention,
        presentation: entry.presentation,
        openRequests: entry.openRequests,
        activity: entry.activity,
        streaming: entry.streaming,
      });
      if (state !== entry.state) {
        entry.state = state;
        changed = true;
      }
      if (entry.turnActive) tools += entry.activity.runningTools;
    }
    options.setToolsRunning(tools);
    return changed;
  }

  function wantsSampling(): boolean {
    for (const entry of tracked.values()) {
      if ((entry.inPane || entry.inTab) && entry.presentation === "gui" && entry.turnActive) {
        return true;
      }
    }
    return false;
  }

  function updateSampling(): void {
    // Streaming only feeds effects; the tools count needs no sampling.
    const want = running && options.effects.get().enabled && wantsSampling();
    if (want && samplingHandle === null) {
      samplingHandle = setRepeating(sampleNow, STREAM_SAMPLE_INTERVAL_MS);
    } else if (!want && samplingHandle !== null) {
      clearRepeating(samplingHandle);
      samplingHandle = null;
      sampler.clear();
      for (const entry of tracked.values()) {
        entry.streamRate = 0;
        entry.streaming = false;
      }
      if (computeStates() && options.effects.get().enabled) applicator.schedule();
      publishEnergy(combinedPaneEnergy());
    }
  }

  function sampleNow(): void {
    if (doc.visibilityState === "hidden") return;
    const state = options.store.getState();
    const at = now();
    let changed = false;
    for (const [id, entry] of tracked) {
      let rate = 0;
      const itemId = entry.activity.streamItemId;
      const sampled =
        (entry.inPane || entry.inTab) && entry.presentation === "gui" && entry.turnActive;
      const item = sampled && itemId ? state.runtimeItemsByIdByThread[id]?.[itemId] : undefined;
      if (item && itemId && item.state !== "completed") {
        rate = sampler.sample(id, itemId, readAssistantStreamLength(item), at);
      } else {
        sampler.forget(id);
      }
      entry.streamRate = rate;
      const streaming = rate >= STREAMING_MIN_RATE;
      if (streaming !== entry.streaming) {
        entry.streaming = streaming;
        changed = true;
      }
    }
    if (changed) refreshStates();
    publishEnergy(combinedPaneEnergy());
    // Re-asserts attributes on remounted panes/tabs and moves pane energy.
    if (options.effects.get().enabled) applicator.schedule();
  }

  function sync(): void {
    const state = options.store.getState();
    lastState = state;
    const nextPaneIds = selectPaneThreadIds(state.view);
    const nextTabIds = options.tabs.getIds();
    let changed = nextPaneIds !== paneIds || nextTabIds !== tabIds;
    paneIds = nextPaneIds;
    tabIds = nextTabIds;
    const paneSet = new Set(paneIds);
    const tabSet = new Set(tabIds);
    const ids = collectTrackedThreadIds(paneIds, tabIds, getTurnActiveThreadIds(state.threads));
    const keep = new Set<string>();
    const threadMap = getThreadMap(state.threads);
    for (const id of ids) {
      const thread = threadMap.get(id);
      if (!thread) continue;
      keep.add(id);
      const presentation = resolveFxPresentation(thread);
      const itemIds = state.runtimeItemIdsByThread[id];
      const openRequests =
        presentation === "gui" ? (state.runtimeRequestsByThread[id]?.length ?? 0) : 0;
      const signature = threadSignature({
        status: thread.status,
        attention: thread.attention,
        interruptedTurn: thread.interruptedTurn,
        presentation,
        structuralVersion: state.runtimeStructuralVersionByThread[id] ?? 0,
        itemCount: itemIds?.length ?? 0,
        openRequests,
      });
      const inPane = paneSet.has(id);
      const inTab = tabSet.has(id);
      const previous = tracked.get(id);
      if (previous && previous.signature === signature) {
        if (previous.inPane !== inPane || previous.inTab !== inTab) {
          previous.inPane = inPane;
          previous.inTab = inTab;
          changed = true;
        }
        continue;
      }
      changed = true;
      const snapshot: TurnSnapshot = {
        status: thread.status,
        attention: thread.attention,
        interruptedTurn: thread.interruptedTurn,
      };
      const turnActive = isThreadTurnActive(thread.status);
      const activity =
        presentation === "gui" && turnActive
          ? deriveThreadActivity(itemIds, state.runtimeItemsByIdByThread[id])
          : IDLE_ACTIVITY;
      const flash = previous ? detectTurnTransition(previous.snapshot, snapshot) : null;
      const entry: TrackedThread = previous ?? {
        signature,
        snapshot,
        presentation,
        turnActive,
        openRequests,
        activity,
        inPane,
        inTab,
        streamRate: 0,
        streaming: false,
        state: "idle",
        flash: null,
        flashTimer: null,
      };
      entry.signature = signature;
      entry.snapshot = snapshot;
      entry.presentation = presentation;
      entry.turnActive = turnActive;
      entry.openRequests = openRequests;
      if (activity.streamItemId !== entry.activity.streamItemId || !turnActive) {
        entry.streamRate = 0;
        entry.streaming = false;
        sampler.forget(id);
      }
      entry.activity = activity;
      entry.inPane = inPane;
      entry.inTab = inTab;
      tracked.set(id, entry);
      if (flash) startFlash(entry, flash);
    }
    for (const [id, entry] of tracked) {
      if (!keep.has(id)) {
        forget(id, entry);
        changed = true;
      }
    }
    if (refreshStates()) changed = true;
    if (changed) {
      publishEnergy(combinedPaneEnergy());
      if (options.effects.get().enabled) applicator.schedule();
    }
  }

  function onStoreChange(state: AgentMonitorState): void {
    const previous = lastState;
    if (
      previous &&
      state.threads === previous.threads &&
      state.view === previous.view &&
      state.runtimeItemIdsByThread === previous.runtimeItemIdsByThread &&
      state.runtimeRequestsByThread === previous.runtimeRequestsByThread &&
      state.runtimeStructuralVersionByThread === previous.runtimeStructuralVersionByThread
    ) {
      // Streaming deltas land here: only the item map moved.
      return;
    }
    sync();
  }

  function applyEffectsSettings(): void {
    const effects = options.effects.get();
    const wantTyping = running && effects.enabled && effects.typingGlow;
    if (wantTyping && !uninstallTyping) uninstallTyping = installTyping(doc);
    if (!wantTyping && uninstallTyping) {
      uninstallTyping();
      uninstallTyping = null;
    }
    if (!effects.enabled) {
      applicator.clear();
    } else {
      applicator.schedule();
    }
    updateSampling();
    publishEnergy(combinedPaneEnergy());
  }

  function stop(): void {
    if (!running) return;
    running = false;
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers = [];
    if (samplingHandle !== null) clearRepeating(samplingHandle);
    samplingHandle = null;
    for (const [id, entry] of tracked) forget(id, entry);
    overrides.clear();
    sampler.clear();
    uninstallTyping?.();
    uninstallTyping = null;
    applicator.clear();
    publishedEnergy = 0;
    options.setEnergy(0);
    options.setToolsRunning(0);
    lastState = null;
    paneIds = NO_IDS;
    tabIds = NO_IDS;
  }

  return {
    start() {
      if (running) return;
      running = true;
      // The monitor owns the energy bus: start from rest.
      publishedEnergy = 0;
      options.setEnergy(0);
      unsubscribers = [
        options.store.subscribe(onStoreChange),
        options.tabs.subscribe(sync),
        options.effects.subscribe(applyEffectsSettings),
      ];
      sync();
      applyEffectsSettings();
    },
    stop,
    snapshot() {
      return [...tracked].map(([threadId, entry]) => ({
        threadId,
        state: entry.state,
        flash: entry.flash,
        presentation: entry.presentation,
        runningTools: entry.activity.runningTools,
        thinking: entry.activity.thinking,
        streamRate: Math.round(entry.streamRate * 10) / 10,
        energy: Math.round(streamEnergyFromRate(entry.streamRate) * 100) / 100,
        inPane: entry.inPane,
        inTab: entry.inTab,
        simulated: overrides.get(threadId)?.state ?? null,
      }));
    },
    simulate(threadId, state, simulateOptions) {
      if (state === null) overrides.delete(threadId);
      else {
        overrides.set(threadId, {
          state,
          flash: simulateOptions?.flash ?? null,
          energy: Math.min(1, Math.max(0, simulateOptions?.energy ?? 0.7)),
        });
      }
      publishEnergy(combinedPaneEnergy());
      if (options.effects.get().enabled) applicator.schedule();
    },
    sampleNow,
    flushDom() {
      if (options.effects.get().enabled) applicator.flush();
    },
    isSampling() {
      return samplingHandle !== null;
    },
  };
}
