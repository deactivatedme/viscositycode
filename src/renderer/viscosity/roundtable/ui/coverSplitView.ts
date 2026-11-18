/**
 * ViscosityCode UI: a panel drawn over the center split view (the open
 * Roundtable, a Grok bot's chat) takes the split view's place for keyboard
 * and assistive technology too, not only visually.
 *
 * While the panel is mounted, every other child of its container (the
 * panes underneath: `[data-vc-center-body]` in the desktop shell) is `inert`,
 * including children added later, and focus moves into the panel. When the
 * panel goes away the attribute is removed again and, if focus was still
 * inside the panel, it returns to where it was before the panel opened. A
 * user who already moved on (clicked a tab, the sidebar) keeps their focus.
 *
 * Several panels may cover the same container in turn: each element stays
 * inert until the last panel holding it lets go, and an element that was
 * already inert for another reason is left alone.
 */
import { type RefObject, useLayoutEffect } from "react";

/** Marks a covering panel (`data-vc-cover-panel=""`): other covering panels never make it inert. */
const COVER_PANEL_ATTRIBUTE = "data-vc-cover-panel";

/** Element → the panels currently holding it inert. */
const holds = new WeakMap<Element, Set<symbol>>();

function hold(element: Element, token: symbol): boolean {
  let owners = holds.get(element);
  if (!owners) {
    // Inert for someone else's reason: not ours to change or restore.
    if (element.hasAttribute("inert")) return false;
    owners = new Set();
    holds.set(element, owners);
    element.setAttribute("inert", "");
  }
  owners.add(token);
  return true;
}

function release(element: Element, token: symbol): void {
  const owners = holds.get(element);
  if (!owners?.delete(token) || owners.size > 0) return;
  holds.delete(element);
  element.removeAttribute("inert");
}

function isFocusable(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element.isConnected && element.closest("[inert]") === null;
}

/**
 * Covers the panel's siblings and moves focus into the panel; returns the
 * release. The panel should be focusable (`tabIndex={-1}`) and carry
 * `data-vc-cover-panel=""`.
 */
export function coverSplitView(panel: HTMLElement): () => void {
  const container = panel.parentElement;
  const token = Symbol("cover");
  const held = new Set<Element>();
  const previousFocus =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

  function cover(element: Element): void {
    if (element === panel || element.hasAttribute(COVER_PANEL_ATTRIBUTE)) return;
    if (hold(element, token)) held.add(element);
  }

  let observer: MutationObserver | undefined;
  if (container) {
    for (const child of container.children) cover(child);
    // Panes or overlays mounted while the panel is open are covered too.
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.parentElement === container) cover(node);
        }
      }
    });
    observer.observe(container, { childList: true });
  }

  if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });

  return () => {
    observer?.disconnect();
    for (const element of held) release(element, token);
    held.clear();
    const active = document.activeElement;
    const focusInPanel = active === null || active === document.body || panel.contains(active);
    if (focusInPanel && isFocusable(previousFocus)) previousFocus.focus({ preventScroll: true });
  };
}

/** {@link coverSplitView} for as long as the component holding `panelRef` is mounted. */
export function useCoverSplitView(panelRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    return panel ? coverSplitView(panel) : undefined;
  }, [panelRef]);
}
