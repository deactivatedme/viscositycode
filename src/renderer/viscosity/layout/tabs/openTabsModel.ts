/**
 * ViscosityCode open-thread tabs: pure list logic (no store, no React).
 *
 * The tab strip is a client view over upstream's split-pane tree: it never
 * changes `AppView` or the persisted pane layout. A tab is just a thread id the
 * user had on screen in this window; the list is kept in insertion order.
 */

/** Versioned local-storage key; the value is `{ "ids": string[] }`. */
export const OPEN_TABS_STORAGE_KEY = "viscosity:open-tabs:v1";

/** Oldest tabs that are not on screen are dropped past this many. */
export const MAX_OPEN_TABS = 40;

const EMPTY_IDS: readonly string[] = [];

export interface TabThreadInfo {
  archived: boolean;
  projectId: string;
}

/**
 * Append ids that are not open yet. When the list grows past `max`, the oldest
 * tabs that are not in `protectedIds` (the threads on screen) are dropped.
 * Returns `current` unchanged when nothing was added.
 */
export function addOpenTabs(
  current: readonly string[],
  incoming: readonly string[],
  options: { max?: number; protectedIds?: ReadonlySet<string> } = {},
): readonly string[] {
  const present = new Set(current);
  const added: string[] = [];
  for (const id of incoming) {
    if (!id || present.has(id)) continue;
    present.add(id);
    added.push(id);
  }
  if (added.length === 0) return current;
  return capOpenTabs([...current, ...added], options.max ?? MAX_OPEN_TABS, options.protectedIds);
}

function capOpenTabs(
  ids: string[],
  max: number,
  protectedIds: ReadonlySet<string> | undefined,
): readonly string[] {
  let overflow = ids.length - Math.max(0, max);
  if (overflow <= 0) return ids;
  const kept: string[] = [];
  for (const id of ids) {
    if (overflow > 0 && !protectedIds?.has(id)) {
      overflow -= 1;
      continue;
    }
    kept.push(id);
  }
  return kept;
}

export function removeOpenTab(current: readonly string[], id: string): readonly string[] {
  return current.includes(id) ? current.filter((candidate) => candidate !== id) : current;
}

/**
 * Drop tabs whose thread was archived, or deleted. A thread counts as deleted
 * when it was known in the previous snapshot and is gone now while its project
 * is still loaded. A tab whose thread was never seen (catalog still loading) or
 * whose project disappeared with it (a paired host went offline) is kept, just
 * not rendered, so it comes back when the host does.
 */
export function pruneOpenTabs(
  current: readonly string[],
  input: {
    threads: ReadonlyMap<string, TabThreadInfo>;
    previouslyKnown: ReadonlyMap<string, string>;
    projectIds: ReadonlySet<string>;
  },
): readonly string[] {
  let changed = false;
  const kept = current.filter((id) => {
    const thread = input.threads.get(id);
    let keep: boolean;
    if (thread) {
      keep = !thread.archived;
    } else {
      const previousProjectId = input.previouslyKnown.get(id);
      keep = previousProjectId === undefined || !input.projectIds.has(previousProjectId);
    }
    if (!keep) changed = true;
    return keep;
  });
  return changed ? kept : current;
}

/** The tabs the strip shows: open ids whose thread is loaded and not archived. */
export function selectRenderableTabs(
  current: readonly string[],
  threads: ReadonlyMap<string, Pick<TabThreadInfo, "archived">>,
): readonly string[] {
  if (current.length === 0) return EMPTY_IDS;
  return current.filter((id) => {
    const thread = threads.get(id);
    return thread !== undefined && !thread.archived;
  });
}

/**
 * The tab to show in place of a closed one: the next tab to its right, else
 * the nearest to its left, skipping threads already on screen in another pane.
 */
export function resolveNextTabAfterClose(
  tabs: readonly string[],
  closingId: string,
  visiblePaneIds: readonly string[],
): string | null {
  const index = tabs.indexOf(closingId);
  if (index === -1) return null;
  const onScreen = new Set(visiblePaneIds);
  for (let next = index + 1; next < tabs.length; next += 1) {
    const id = tabs[next]!;
    if (!onScreen.has(id)) return id;
  }
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const id = tabs[previous]!;
    if (!onScreen.has(id)) return id;
  }
  return null;
}

export interface OpenTabsSyncState {
  /** On-screen thread ids already offered to the tab list this visit. */
  processedVisible: ReadonlySet<string>;
  /** Thread id → project id from the previous snapshot (deletion detection). */
  knownThreads: ReadonlyMap<string, string>;
}

export const INITIAL_OPEN_TABS_SYNC_STATE: OpenTabsSyncState = {
  processedVisible: new Set(),
  knownThreads: new Map(),
};

export interface OpenTabsSnapshot {
  /** Pane ids of the current thread view, in pane order (empty otherwise). */
  visiblePaneIds: readonly string[];
  threads: ReadonlyMap<string, TabThreadInfo>;
  projectIds: ReadonlySet<string>;
}

/**
 * One reconciliation step: prune archived/deleted tabs, then open a tab for
 * every thread that newly appeared on screen. A thread is offered once per
 * visit, so closing the tab of a thread that is still on screen (for a frame,
 * while its pane is replaced) does not reopen it.
 */
export function stepOpenTabsSync(
  tabs: readonly string[],
  sync: OpenTabsSyncState,
  snapshot: OpenTabsSnapshot,
): { tabs: readonly string[]; sync: OpenTabsSyncState } {
  let nextTabs = pruneOpenTabs(tabs, {
    threads: snapshot.threads,
    previouslyKnown: sync.knownThreads,
    projectIds: snapshot.projectIds,
  });

  const visibleThreads: string[] = [];
  const newlyVisible: string[] = [];
  for (const id of snapshot.visiblePaneIds) {
    const thread = snapshot.threads.get(id);
    if (!thread || thread.archived) continue;
    visibleThreads.push(id);
    if (!sync.processedVisible.has(id)) newlyVisible.push(id);
  }
  nextTabs = addOpenTabs(nextTabs, newlyVisible, { protectedIds: new Set(visibleThreads) });

  const knownThreads = new Map<string, string>();
  for (const [id, thread] of snapshot.threads) knownThreads.set(id, thread.projectId);

  return {
    tabs: nextTabs,
    sync: { processedVisible: new Set(visibleThreads), knownThreads },
  };
}

/** Parse the stored v1 value; anything malformed (or from a newer shape) reads as empty. */
export function parseStoredOpenTabs(raw: string | null | undefined): readonly string[] {
  if (!raw) return EMPTY_IDS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_IDS;
  }
  if (typeof parsed !== "object" || parsed === null || !("ids" in parsed)) return EMPTY_IDS;
  const ids = (parsed as { ids: unknown }).ids;
  if (!Array.isArray(ids)) return EMPTY_IDS;
  const unique = [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ];
  return unique.length > MAX_OPEN_TABS ? unique.slice(unique.length - MAX_OPEN_TABS) : unique;
}

export function serializeOpenTabs(ids: readonly string[]): string {
  return JSON.stringify({ ids });
}
