/**
 * ViscosityCode: marks the focused pane of a split view for zen mode (fork of
 * Poracode).
 *
 * The split view positions each pane with inline left/top/width/height inside
 * one absolutely positioned container. Zen mode shows only the focused pane,
 * full size: this module tags that pane's slot (`data-vc-zen-pane`) and its
 * container (`data-vc-zen-split`); zen.css does the rest. Attribute writes
 * only, no layout reads.
 *
 * Panes are identified by their pane id (`focusedPaneId`), which covers thread
 * panes and draft ("New thread") panes alike:
 *   1. any element carrying `data-vc-pane-id` with that id (the stable hook);
 *   2. a thread pane, whose pane id is its thread id (`data-vc-thread-id`);
 *   3. a draft pane, whose markup carries no id: the slot the tracker saw
 *      focus enter while that draft was the focused pane (the split's own
 *      focus handler sets `focusedPaneId` as focus enters a pane), or else
 *      the split's only draft slot not already claimed by another live pane.
 * When the focused pane cannot be found, nothing is tagged and the split
 * stays as it is.
 */
import { isDraftPaneId } from "@/shared/paneId";

export const ZEN_PANE_ATTRIBUTE = "data-vc-zen-pane";
export const ZEN_SPLIT_ATTRIBUTE = "data-vc-zen-split";

/** Stable hook carrying a pane's id (thread, draft or thread-window placeholder pane). */
export const PANE_ID_ATTRIBUTE = "data-vc-pane-id";
/** ThreadView's pane root and the thread id it carries. */
const PANE_ROOT_SELECTOR = "[data-poracode-thread-pane]";
const PANE_THREAD_ID_ATTRIBUTE = "data-vc-thread-id";
const PANE_HIDDEN_ATTRIBUTE = "data-poracode-pane-hidden";
/** ThreadDraftView's root; also used inside thread panes (side chat), which are skipped. */
const DRAFT_ROOT_SELECTOR = "[data-draft-composer]";
/** The fork's center column (ViscosityCenterFrame). */
const CENTER_BODY_SELECTOR = "[data-vc-center-body]";

/** The pane id a split slot is known to show, if any (see `startZenFocusPaneTracker`). */
export type ZenSlotPaneId = (slot: HTMLElement) => string | undefined;

/** The split view's slot around a pane: the nearest ancestor it positions inline. */
function findPaneSlot(paneElement: HTMLElement, boundary: Element): HTMLElement | null {
  let node: HTMLElement | null = paneElement;
  while (node && node !== boundary) {
    if (node.style.left !== "" && node.style.width !== "") return node;
    node = node.parentElement;
  }
  return null;
}

/** The slot of the first candidate that sits in the split (not in an overlay or a hidden pane). */
function firstSlot(candidates: Iterable<HTMLElement>, boundary: Element): HTMLElement | null {
  for (const candidate of candidates) {
    const slot = findPaneSlot(candidate, boundary);
    if (slot) return slot;
  }
  return null;
}

function* withAttribute(scope: ParentNode, selector: string, name: string, value: string) {
  for (const element of scope.querySelectorAll<HTMLElement>(selector)) {
    if (element.getAttribute(name) === value) yield element;
  }
}

function* visibleThreadPanes(scope: ParentNode, paneId: string) {
  for (const pane of withAttribute(scope, PANE_ROOT_SELECTOR, PANE_THREAD_ID_ATTRIBUTE, paneId)) {
    if (!pane.hasAttribute(PANE_HIDDEN_ATTRIBUTE)) yield pane;
  }
}

/** Every split slot that shows a draft pane (drafts inside thread panes excluded). */
function draftSlots(centerBody: Element): HTMLElement[] {
  const slots: HTMLElement[] = [];
  for (const draft of centerBody.querySelectorAll<HTMLElement>(DRAFT_ROOT_SELECTOR)) {
    if (draft.closest(PANE_ROOT_SELECTOR)) continue;
    const slot = findPaneSlot(draft, centerBody);
    if (slot && !slots.includes(slot)) slots.push(slot);
  }
  return slots;
}

/**
 * The draft pane's slot: the one known to show it, or else the only draft slot
 * not known to show another pane; `null` when that is ambiguous.
 */
function findDraftSlot(
  centerBody: Element,
  paneId: string,
  slotPaneId: ZenSlotPaneId | undefined,
): HTMLElement | null {
  const slots = draftSlots(centerBody);
  const known = slots.find((slot) => slotPaneId?.(slot) === paneId);
  if (known) return known;
  const unclaimed = slots.filter((slot) => slotPaneId?.(slot) === undefined);
  return unclaimed.length === 1 ? (unclaimed[0] ?? null) : null;
}

function findFocusedSlot(
  centerBody: Element,
  paneId: string,
  slotPaneId: ZenSlotPaneId | undefined,
): HTMLElement | null {
  return (
    firstSlot(
      withAttribute(centerBody, `[${PANE_ID_ATTRIBUTE}]`, PANE_ID_ATTRIBUTE, paneId),
      centerBody,
    ) ??
    firstSlot(visibleThreadPanes(centerBody, paneId), centerBody) ??
    (isDraftPaneId(paneId) ? findDraftSlot(centerBody, paneId, slotPaneId) : null)
  );
}

export function clearZenFocusedPane(root: ParentNode): void {
  for (const element of root.querySelectorAll(`[${ZEN_PANE_ATTRIBUTE}]`)) {
    element.removeAttribute(ZEN_PANE_ATTRIBUTE);
  }
  for (const element of root.querySelectorAll(`[${ZEN_SPLIT_ATTRIBUTE}]`)) {
    element.removeAttribute(ZEN_SPLIT_ATTRIBUTE);
  }
}

/**
 * Tags the focused pane's slot and its split container, clearing any older
 * tags. `slotPaneId` tells which draft a slot shows, when that is known.
 * Returns whether a pane was tagged.
 */
export function markZenFocusedPane(
  root: ParentNode,
  focusedPaneId: string | null,
  slotPaneId?: ZenSlotPaneId,
): boolean {
  const centerBody = root.querySelector(CENTER_BODY_SELECTOR);
  const slot =
    centerBody && focusedPaneId ? findFocusedSlot(centerBody, focusedPaneId, slotPaneId) : null;
  const split = slot?.parentElement ?? null;
  if (
    slot?.hasAttribute(ZEN_PANE_ATTRIBUTE) &&
    split?.hasAttribute(ZEN_SPLIT_ATTRIBUTE) &&
    root.querySelectorAll(`[${ZEN_PANE_ATTRIBUTE}], [${ZEN_SPLIT_ATTRIBUTE}]`).length === 2
  ) {
    return true;
  }
  clearZenFocusedPane(root);
  if (!slot || !split) return false;
  slot.setAttribute(ZEN_PANE_ATTRIBUTE, "");
  split.setAttribute(ZEN_SPLIT_ATTRIBUTE, "");
  return true;
}

export interface ZenFocusPaneTrackerOptions {
  /** The document (or an element of it) holding the center column. */
  root: Document | Element;
  readFocusedPaneId: () => string | null;
  /** Ids of the panes the view holds now; a slot learned for any other id is forgotten. */
  readPaneIds?: () => readonly string[];
  /** Fires whenever pane focus or the pane layout may have changed. */
  subscribe: (listener: () => void) => () => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * Keeps the tags on the focused pane while zen mode is on: re-tags one frame
 * after a change (so React has committed the new pane) and clears every tag on
 * dispose.
 *
 * A draft pane carries no id in its markup, so the tracker learns which slot
 * shows which draft from focus: the split sets `focusedPaneId` from a capture
 * listener as focus enters a pane, so on `focusin` (bubbling to the document,
 * after that listener) the focused pane id names the slot focus is in.
 */
export function startZenFocusPaneTracker(options: ZenFocusPaneTrackerOptions): () => void {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const doc = options.root instanceof Document ? options.root : options.root.ownerDocument;
  // Split slot → the draft pane id focus last entered it with.
  const draftOfSlot = new WeakMap<HTMLElement, string>();
  let pending: number | null = null;

  function learn(target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    const paneId = options.readFocusedPaneId();
    if (!paneId || !isDraftPaneId(paneId)) return;
    const centerBody = target.closest(CENTER_BODY_SELECTOR);
    if (!centerBody || !options.root.contains(centerBody)) return;
    const start = target.closest<HTMLElement>(DRAFT_ROOT_SELECTOR) ?? target;
    // Focus inside a thread pane (its side chat's draft included) names no draft.
    if (start.closest(PANE_ROOT_SELECTOR)) return;
    const slot = findPaneSlot(start, centerBody);
    if (slot) draftOfSlot.set(slot, paneId);
  }

  function flush(): void {
    pending = null;
    const livePaneIds = options.readPaneIds?.();
    markZenFocusedPane(options.root, options.readFocusedPaneId(), (slot) => {
      const paneId = draftOfSlot.get(slot);
      return paneId !== undefined && (!livePaneIds || livePaneIds.includes(paneId))
        ? paneId
        : undefined;
    });
  }
  function schedule(): void {
    if (pending !== null) return;
    pending = requestFrame(flush);
  }
  function onFocusIn(event: FocusEvent): void {
    learn(event.target);
    schedule();
  }

  learn(doc.activeElement);
  flush();
  // A pane that mounts lazily may appear a frame later.
  schedule();
  const unsubscribe = options.subscribe(schedule);
  doc.addEventListener("focusin", onFocusIn);
  return () => {
    unsubscribe();
    doc.removeEventListener("focusin", onFocusIn);
    if (pending !== null) cancelFrame(pending);
    pending = null;
    clearZenFocusedPane(options.root);
  };
}
