/**
 * ViscosityCode: room for the "Exit Zen" pill on the revealed tab strip (fork
 * of Poracode).
 *
 * The pill floats over the top-right corner of the window, where the revealed
 * tab strip ends with its "+" (new thread) button once the tabs overflow. The
 * pill's label is localized, so its width is measured here and published as
 * `--vc-zen-pill-width` on <html>; zen.css reserves that much (plus the pill's
 * offset) at the strip's right end. Writes happen only when the pill itself
 * resizes (locale or font changes), never on streaming updates.
 */

export const ZEN_PILL_WIDTH_PROPERTY = "--vc-zen-pill-width";

export interface ZenPillReserveOptions {
  pill: HTMLElement;
  /** Carries the custom property (the document element). */
  root: HTMLElement;
  /** Injected for tests; defaults to the global ResizeObserver when there is one. */
  ResizeObserver?: typeof ResizeObserver | undefined;
}

function publish(root: HTMLElement, width: number): void {
  if (!(width > 0)) return;
  const value = `${Math.ceil(width)}px`;
  if (root.style.getPropertyValue(ZEN_PILL_WIDTH_PROPERTY) !== value) {
    root.style.setProperty(ZEN_PILL_WIDTH_PROPERTY, value);
  }
}

/** Publishes the pill's width until disposed; disposing removes the property again. */
export function startZenPillReserve(options: ZenPillReserveOptions): () => void {
  const { pill, root } = options;
  const Observer =
    options.ResizeObserver ??
    (typeof ResizeObserver === "undefined" ? undefined : globalThis.ResizeObserver);
  publish(root, pill.getBoundingClientRect().width);
  // One layout read per pill resize, which only a locale or font change causes.
  const observer = Observer
    ? new Observer(() => publish(root, pill.getBoundingClientRect().width))
    : undefined;
  observer?.observe(pill);
  return () => {
    observer?.disconnect();
    root.style.removeProperty(ZEN_PILL_WIDTH_PROPERTY);
  };
}
