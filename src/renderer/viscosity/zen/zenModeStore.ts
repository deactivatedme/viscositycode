/**
 * ViscosityCode: Zen mode state (fork of Poracode).
 *
 * Zen mode is a transient view of the desktop shell: the activity bar,
 * sidebar, tab strip, status bar and right/git panels are hidden by CSS
 * (zen.css) while `html[data-vc-zen]` is set, and the focused pane is centred.
 * Nothing is persisted: a restart (or a window that loses the desktop shell)
 * always starts with zen off.
 */
import { create } from "zustand";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";

/** Set on <html> while zen mode is on. Every zen rule also requires `data-vc-shell`. */
export const ZEN_ATTRIBUTE = "data-vc-zen";

interface ZenModeState {
  active: boolean;
}

export const useZenModeStore = create<ZenModeState>()(() => ({ active: false }));

function rootElement(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

/** Writes (or clears) `html[data-vc-zen]`. */
export function applyZenAttribute(root: Element, active: boolean): void {
  if (active) root.setAttribute(ZEN_ATTRIBUTE, "");
  else root.removeAttribute(ZEN_ATTRIBUTE);
}

export function isZenModeActive(): boolean {
  return useZenModeStore.getState().active;
}

/**
 * Turns zen mode on. A no-op outside the fork's desktop shell (compact/PWA
 * layout, extension side panel, secondary windows), which keep upstream's
 * layout. Returns whether zen mode is on afterwards.
 */
export function enterZenMode(): boolean {
  if (isZenModeActive()) return true;
  if (!isViscosityShellActive()) return false;
  const root = rootElement();
  if (root) applyZenAttribute(root, true);
  useZenModeStore.setState({ active: true });
  return true;
}

export function exitZenMode(): void {
  const root = rootElement();
  if (root) applyZenAttribute(root, false);
  if (!isZenModeActive()) return;
  useZenModeStore.setState({ active: false });
}

/** Palette command and keybinding target. */
export function toggleZenMode(): void {
  if (isZenModeActive()) exitZenMode();
  else enterZenMode();
}
