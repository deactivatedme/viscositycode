/**
 * ViscosityCode: composer typing glow and caret ripple (Step 4).
 *
 * One document-level `input` listener, filtered to the composer's mention
 * input. It never touches React state and never delays the keystroke: the
 * surface attribute is a single attribute write, and the ripple reads the
 * caret position in one animation frame and moves the ripple in the next, so
 * a layout read never follows a write within a frame.
 */

/** The composer's contenteditable. */
export const COMPOSER_INPUT_SELECTOR = ".poracode-mention-input";
/** The bordered composer surface that glows. */
export const COMPOSER_SURFACE_SELECTOR = ".poracode-composer-shell";
export const TYPING_ATTRIBUTE = "data-vc-typing";
export const RIPPLE_CLASS = "vc-fx-caret-ripple";
const RIPPLE_PHASE_ATTRIBUTE = "data-vc-ripple";

/** How long the surface keeps glowing after the last keystroke. */
export const TYPING_HOLD_MS = 700;
/** At most one caret ripple per interval. */
export const RIPPLE_MIN_INTERVAL_MS = 90;

export interface CaretPoint {
  readonly x: number;
  readonly y: number;
}

export interface TypingGlowOptions {
  document: Document;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Reads the caret position inside `input`; layout read, called inside a frame. */
  readCaret?: (doc: Document, input: Element) => CaretPoint | null;
  holdMs?: number;
  rippleIntervalMs?: number;
}

/** Caret centre in viewport coordinates, or null when the selection is elsewhere. */
export function readCaretPoint(doc: Document, input: Element): CaretPoint | null {
  const selection = doc.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!input.contains(range.endContainer)) return null;
  if (typeof range.getBoundingClientRect !== "function") return null;
  let rect: DOMRect | undefined = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && typeof range.getClientRects === "function") {
    rect = range.getClientRects()[0];
  }
  if (!rect || rect.height === 0) return null;
  return { x: rect.right, y: rect.top + rect.height / 2 };
}

function isElement(target: EventTarget | null): target is Element {
  return (
    target !== null &&
    typeof (target as Partial<Element>).closest === "function" &&
    typeof (target as Partial<Element>).getAttribute === "function"
  );
}

/** Install the listener; returns the uninstall (which also clears what it drew). */
export function installTypingGlow(options: TypingGlowOptions): () => void {
  const doc = options.document;
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ?? ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  const readCaret = options.readCaret ?? readCaretPoint;
  const holdMs = options.holdMs ?? TYPING_HOLD_MS;
  const rippleIntervalMs = options.rippleIntervalMs ?? RIPPLE_MIN_INTERVAL_MS;

  let surface: Element | null = null;
  let input: Element | null = null;
  let lastInputAt = 0;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRippleAt = Number.NEGATIVE_INFINITY;
  let readHandle: number | null = null;
  let writeHandle: number | null = null;
  let ripple: HTMLElement | null = null;
  let ripplePhase = false;

  function releaseSurface(): void {
    surface?.removeAttribute(TYPING_ATTRIBUTE);
    surface = null;
    input = null;
  }

  function checkHold(): void {
    holdTimer = null;
    const idle = now() - lastInputAt;
    if (idle >= holdMs) {
      releaseSurface();
      return;
    }
    holdTimer = setTimer(checkHold, holdMs - idle);
  }

  function ensureRipple(): HTMLElement {
    if (ripple?.isConnected) return ripple;
    ripple = doc.createElement("div");
    ripple.className = RIPPLE_CLASS;
    ripple.setAttribute("aria-hidden", "true");
    doc.body.appendChild(ripple);
    return ripple;
  }

  function writeRipple(point: CaretPoint): void {
    writeHandle = null;
    const element = ensureRipple();
    element.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
    // Alternating keyframe names restart the animation without a forced reflow.
    ripplePhase = !ripplePhase;
    element.setAttribute(RIPPLE_PHASE_ATTRIBUTE, ripplePhase ? "a" : "b");
  }

  function readRipple(): void {
    readHandle = null;
    const target = input;
    if (!target?.isConnected) return;
    const point = readCaret(doc, target);
    if (!point) return;
    writeHandle = requestFrame(() => writeRipple(point));
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (!isElement(target)) return;
    const nextInput = target.closest(COMPOSER_INPUT_SELECTOR);
    if (!nextInput) return;
    const nextSurface = nextInput.closest(COMPOSER_SURFACE_SELECTOR) ?? nextInput;
    if (surface !== nextSurface) {
      surface?.removeAttribute(TYPING_ATTRIBUTE);
      surface = nextSurface;
    }
    input = nextInput;
    if (!surface.hasAttribute(TYPING_ATTRIBUTE)) surface.setAttribute(TYPING_ATTRIBUTE, "");
    const at = now();
    lastInputAt = at;
    if (holdTimer === null) holdTimer = setTimer(checkHold, holdMs);
    if (at - lastRippleAt < rippleIntervalMs || readHandle !== null || writeHandle !== null) return;
    lastRippleAt = at;
    readHandle = requestFrame(readRipple);
  }

  doc.addEventListener("input", onInput, true);

  return () => {
    doc.removeEventListener("input", onInput, true);
    if (holdTimer !== null) clearTimer(holdTimer);
    if (readHandle !== null) cancelFrame(readHandle);
    if (writeHandle !== null) cancelFrame(writeHandle);
    holdTimer = null;
    readHandle = null;
    writeHandle = null;
    releaseSurface();
    ripple?.remove();
    ripple = null;
  };
}
