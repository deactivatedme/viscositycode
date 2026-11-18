/**
 * ViscosityCode: zen mode's top-edge reveal (fork of Poracode).
 *
 * In zen mode the tab strip waits, hidden, in a band at the top of the window.
 * Hovering the band sets `html[data-vc-zen-reveal]` and zen.css fades the strip
 * in; moving the pointer below the band (or out of the window) fades it out
 * again. The pointer listener exists only while the strip is shown, and the
 * strip's own window-drag areas never flicker it: they swallow pointer events,
 * so only leaving downwards (into the page) or out of the window conceals it.
 */

export const ZEN_REVEAL_ATTRIBUTE = "data-vc-zen-reveal";

/** Pointer travel below the band before the strip hides again. */
export const ZEN_REVEAL_SLACK_PX = 8;

export interface ZenRevealOptions {
  /** Carries the reveal attribute (the document element). */
  root: Element;
  /** The top band the pointer enters to reveal the strip. */
  hotZone: HTMLElement;
  document: Document;
}

export function startZenReveal(options: ZenRevealOptions): () => void {
  const { root, hotZone, document: doc } = options;
  let revealed = false;
  let concealBelow = 0;

  function onPointerMove(event: PointerEvent): void {
    if (event.clientY > concealBelow) conceal();
  }

  function onPointerLeaveWindow(): void {
    conceal();
  }

  function reveal(): void {
    if (revealed) return;
    revealed = true;
    // One layout read per reveal, never per pointer move.
    concealBelow = hotZone.getBoundingClientRect().bottom + ZEN_REVEAL_SLACK_PX;
    root.setAttribute(ZEN_REVEAL_ATTRIBUTE, "");
    doc.addEventListener("pointermove", onPointerMove, { passive: true });
    doc.documentElement.addEventListener("pointerleave", onPointerLeaveWindow);
  }

  function conceal(): void {
    if (!revealed) return;
    revealed = false;
    root.removeAttribute(ZEN_REVEAL_ATTRIBUTE);
    doc.removeEventListener("pointermove", onPointerMove);
    doc.documentElement.removeEventListener("pointerleave", onPointerLeaveWindow);
  }

  hotZone.addEventListener("pointerenter", reveal);
  return () => {
    hotZone.removeEventListener("pointerenter", reveal);
    conceal();
    root.removeAttribute(ZEN_REVEAL_ATTRIBUTE);
  };
}
