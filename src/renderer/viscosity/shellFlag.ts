/**
 * ViscosityCode shell flag (fork of Poracode).
 *
 * Fork shell CSS and behaviour (activity bar, tab strip, status bar, effects)
 * key off `html[data-vc-shell]`. It is set only while the MAIN window renders
 * the desktop, non-compact layout, so the phone/PWA compact layout, the
 * Chrome-extension side panel and the thread / side-chat / quick-composer /
 * browser-extract windows keep upstream's layout untouched.
 */
import { useLayoutEffect } from "react";
import { useCompactLayout } from "@/renderer/adaptiveLayout";
import { isChatSidebarSurface } from "@/renderer/clientSurface";

export const VISCOSITY_SHELL_ATTRIBUTE = "data-vc-shell";

export interface ViscosityShellEnvironment {
  /** `html[data-window-kind]`, written by main.tsx from the bridge at startup. */
  windowKind: string | undefined;
  compactLayout: boolean;
  chatSidebarSurface: boolean;
}

export function shouldEnableViscosityShell(env: ViscosityShellEnvironment): boolean {
  return env.windowKind === "main" && !env.compactLayout && !env.chatSidebarSurface;
}

function readWindowKind(): string | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement.dataset.windowKind;
}

// Several shells can be mounted at once (main + Settings/Git overlays); the
// attribute stays while any of them holds it.
const holdersByRoot = new WeakMap<Element, number>();

/** Set the attribute on `root` until the returned release runs (reference counted). */
export function acquireViscosityShellFlag(root: Element): () => void {
  holdersByRoot.set(root, (holdersByRoot.get(root) ?? 0) + 1);
  root.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (holdersByRoot.get(root) ?? 1) - 1;
    if (remaining > 0) {
      holdersByRoot.set(root, remaining);
      return;
    }
    holdersByRoot.delete(root);
    root.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  };
}

/** Non-React readers (stores, effects) can check the live flag. */
export function isViscosityShellActive(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute(VISCOSITY_SHELL_ATTRIBUTE)
  );
}

/**
 * Installs `html[data-vc-shell]` while this component is mounted and the
 * window qualifies; returns whether the fork shell applies. Layout effect, so
 * the attribute lands before the first paint of the shell.
 */
export function useViscosityShellFlag(): boolean {
  const compactLayout = useCompactLayout();
  const enabled = shouldEnableViscosityShell({
    windowKind: readWindowKind(),
    compactLayout,
    chatSidebarSurface: isChatSidebarSurface(),
  });
  useLayoutEffect(() => {
    if (!enabled) return;
    return acquireViscosityShellFlag(document.documentElement);
  }, [enabled]);
  return enabled;
}
