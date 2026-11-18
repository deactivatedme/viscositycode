/**
 * ViscosityCode: writes agent-state effects onto panes and tabs.
 *
 * Writes are batched into one animation frame and only touch attributes whose
 * value changes. Nothing here reads layout: pane and tab lookup uses selectors
 * and attribute reads only, so a write pass never forces a reflow.
 */

/** ThreadView's pane root. */
export const PANE_SELECTOR = "[data-poracode-thread-pane]";
/** Pane roots kept alive off screen. */
export const PANE_HIDDEN_ATTRIBUTE = "data-poracode-pane-hidden";
/** Preferred thread id on a pane root (see the orchestrator handoff). */
export const PANE_THREAD_ID_ATTRIBUTE = "data-vc-thread-id";
/** Chat panes carry the thread id on their ChatPane root. */
const CHAT_THREAD_ID_ATTRIBUTE = "data-thread-id";
/** Open-thread tab buttons. */
export const TAB_SELECTOR = "[data-vc-tab-id]";
const TAB_THREAD_ID_ATTRIBUTE = "data-vc-tab-id";

export const FX_STATE_ATTRIBUTE = "data-vc-fx-state";
export const FX_FLASH_ATTRIBUTE = "data-vc-fx-flash";
export const FX_ENERGY_PROPERTY = "--vc-fx-energy";

export interface FxThreadVisual {
  /** `data-vc-fx-state` value, or null to remove it. */
  readonly state: string | null;
  /** `data-vc-fx-flash` value, or null to remove it. */
  readonly flash: string | null;
  /** Pane `--vc-fx-energy` (0..1), or null to remove it. */
  readonly energy: number | null;
}

export interface FxDomFrame {
  readonly threads: ReadonlyMap<string, FxThreadVisual>;
  /** `view.panes`, used to identify a pane that carries no thread id. */
  readonly paneThreadIds: readonly string[];
}

export interface FxDomApplicatorOptions {
  document: Document;
  /** Builds the frame at flush time so the latest state wins. */
  readFrame: () => FxDomFrame;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface FxDomApplicator {
  /** Queue one write pass on the next animation frame (coalesced). */
  schedule(): void;
  /** Run the pending (or a fresh) write pass now. */
  flush(): void;
  /** Remove every effect attribute this applicator wrote. */
  clear(): void;
  dispose(): void;
}

function threadIdOfPane(pane: Element): string | null {
  const own = pane.getAttribute(PANE_THREAD_ID_ATTRIBUTE);
  if (own) return own;
  return (
    pane.querySelector(`[${CHAT_THREAD_ID_ATTRIBUTE}]`)?.getAttribute(CHAT_THREAD_ID_ATTRIBUTE) ??
    null
  );
}

/**
 * Thread id per pane, in pane order. Panes that carry no id (terminal panes
 * today) are matched by elimination when exactly one pane and one expected
 * thread are left over.
 */
export function resolvePaneThreadIds(
  panes: readonly Element[],
  expectedIds: readonly string[],
): (string | null)[] {
  const ids = panes.map(threadIdOfPane);
  const unresolved: number[] = [];
  ids.forEach((id, index) => {
    if (id === null) unresolved.push(index);
  });
  if (unresolved.length === 1) {
    const claimed = new Set(ids);
    const left = expectedIds.filter((id) => !claimed.has(id));
    if (left.length === 1) ids[unresolved[0]!] = left[0]!;
  }
  return ids;
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function formatEnergy(energy: number): string {
  return (Math.round(Math.min(1, Math.max(0, energy)) * 100) / 100).toString();
}

function setEnergy(element: Element, energy: number | null): void {
  const style = (element as HTMLElement).style as CSSStyleDeclaration | undefined;
  if (!style) return;
  if (energy === null) {
    if (style.getPropertyValue(FX_ENERGY_PROPERTY)) style.removeProperty(FX_ENERGY_PROPERTY);
    return;
  }
  const value = formatEnergy(energy);
  if (style.getPropertyValue(FX_ENERGY_PROPERTY) !== value) {
    style.setProperty(FX_ENERGY_PROPERTY, value);
  }
}

function writeVisual(element: Element, visual: FxThreadVisual | undefined, pane: boolean): boolean {
  setAttribute(element, FX_STATE_ATTRIBUTE, visual?.state ?? null);
  setAttribute(element, FX_FLASH_ATTRIBUTE, visual?.flash ?? null);
  if (pane) setEnergy(element, visual?.energy ?? null);
  return visual !== undefined && (visual.state !== null || visual.flash !== null);
}

function clearElement(element: Element): void {
  setAttribute(element, FX_STATE_ATTRIBUTE, null);
  setAttribute(element, FX_FLASH_ATTRIBUTE, null);
  setEnergy(element, null);
}

export function createFxDomApplicator(options: FxDomApplicatorOptions): FxDomApplicator {
  const doc = options.document;
  const requestFrame =
    options.requestFrame ?? ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  let handle: number | null = null;
  let disposed = false;
  let touched = new Set<Element>();

  function write(): void {
    const frame = options.readFrame();
    const next = new Set<Element>();
    const panes = Array.from(doc.querySelectorAll(PANE_SELECTOR)).filter(
      (pane) => !pane.hasAttribute(PANE_HIDDEN_ATTRIBUTE),
    );
    const paneIds = resolvePaneThreadIds(panes, frame.paneThreadIds);
    panes.forEach((pane, index) => {
      const id = paneIds[index];
      if (writeVisual(pane, id ? frame.threads.get(id) : undefined, true)) next.add(pane);
    });
    for (const tab of Array.from(doc.querySelectorAll(TAB_SELECTOR))) {
      const id = tab.getAttribute(TAB_THREAD_ID_ATTRIBUTE);
      if (writeVisual(tab, id ? frame.threads.get(id) : undefined, false)) next.add(tab);
    }
    // Panes that went off screen or were re-pointed keep nothing stale.
    for (const element of touched) {
      if (!next.has(element)) clearElement(element);
    }
    touched = next;
  }

  function run(): void {
    handle = null;
    if (!disposed) write();
  }

  function cancelPending(): void {
    if (handle === null) return;
    cancelFrame(handle);
    handle = null;
  }

  function clear(): void {
    cancelPending();
    for (const element of touched) clearElement(element);
    touched = new Set();
  }

  return {
    schedule() {
      if (disposed || handle !== null) return;
      handle = requestFrame(run);
    },
    flush() {
      cancelPending();
      if (!disposed) write();
    },
    clear,
    dispose() {
      clear();
      disposed = true;
    },
  };
}
