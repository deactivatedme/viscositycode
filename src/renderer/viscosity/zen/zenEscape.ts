/**
 * ViscosityCode: Escape leaves zen mode (fork of Poracode).
 *
 * Escape belongs to whatever owns it first: overlays (their capture-phase
 * stack stops the event), popovers and menus (they prevent the default),
 * terminals (agents read Escape as "interrupt"), editors and dialogs. Only an
 * Escape nobody claimed exits zen. The decision waits until the whole
 * dispatch is over, so window listeners registered after this one (e.g. the
 * file editor panel) still get to claim the key first.
 */

/** Focus targets that keep their own Escape (mirrors overlayEscapeStack). */
export const ZEN_ESCAPE_OWNER_SELECTOR = [
  ".xterm",
  ".monaco-editor",
  ".poracode-mention-input",
  "[data-overlay-escape-owner]",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-rac][data-trigger]",
].join(", ");

type EscapeKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "defaultPrevented"
  | "isComposing"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "repeat"
  | "target"
>;

/** A bare, unclaimed Escape from a target that does not own Escape itself. */
export function isZenExitEscape(event: EscapeKeyEvent): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (target instanceof Element && target.closest(ZEN_ESCAPE_OWNER_SELECTOR)) return false;
  return true;
}

export interface ZenEscapeListenerOptions {
  onExit: () => void;
  /** Runs after the current dispatch completes (tests pass a synchronous one). */
  defer?: (callback: () => void) => void;
}

function deferToNextTask(callback: () => void): void {
  setTimeout(callback, 0);
}

/** Installs the window listener; returns its removal. */
export function installZenEscapeListener(
  target: Window,
  options: ZenEscapeListenerOptions,
): () => void {
  const defer = options.defer ?? deferToNextTask;
  let disposed = false;
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    defer(() => {
      if (disposed || !isZenExitEscape(event)) return;
      options.onExit();
    });
  }
  target.addEventListener("keydown", onKeyDown);
  return () => {
    disposed = true;
    target.removeEventListener("keydown", onKeyDown);
  };
}
