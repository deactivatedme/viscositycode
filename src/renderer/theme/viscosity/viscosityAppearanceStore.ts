/**
 * ViscosityCode: client-side appearance preferences.
 *
 * Fork view preferences live in this browser's local storage, not in the host
 * settings document, so the shared settings schema that phones and other
 * clients read stays unchanged (see ARCHITECTURE_NOTES.md §8.6). Every storage
 * access is guarded: private windows, previews and blocked site data fall back
 * to the defaults.
 */

import { create } from "zustand";

export type ViscosityUiFont = "geist" | "system";

export const VISCOSITY_APPEARANCE_STORAGE_KEY = "viscosity:appearance:v1";

/** Font stacks for the UI font choice; Geist matches tokens.css' default. */
export const VISCOSITY_UI_FONT_STACKS: Record<ViscosityUiFont, string> = {
  geist:
    '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  system:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

interface ViscosityAppearancePrefs {
  uiFont: ViscosityUiFont;
}

interface ViscosityAppearanceState extends ViscosityAppearancePrefs {
  setUiFont: (uiFont: ViscosityUiFont) => void;
}

const DEFAULT_PREFS: ViscosityAppearancePrefs = { uiFont: "geist" };

function isUiFont(value: unknown): value is ViscosityUiFont {
  return value === "geist" || value === "system";
}

/** Read persisted prefs; unknown, malformed or unavailable storage yields defaults. */
export function readViscosityAppearancePrefs(): ViscosityAppearancePrefs {
  try {
    const raw = localStorage.getItem(VISCOSITY_APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as { uiFont?: unknown } | null;
    return {
      uiFont: isUiFont(parsed?.uiFont) ? parsed.uiFont : DEFAULT_PREFS.uiFont,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeViscosityAppearancePrefs(prefs: ViscosityAppearancePrefs): void {
  try {
    localStorage.setItem(VISCOSITY_APPEARANCE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
}

export const useViscosityAppearance = create<ViscosityAppearanceState>()((set, get) => ({
  ...readViscosityAppearancePrefs(),
  setUiFont: (uiFont) => {
    if (get().uiFont === uiFont) return;
    set({ uiFont });
    writeViscosityAppearancePrefs({ uiFont });
    applyViscosityAppearance();
  },
}));

/**
 * Write the current prefs onto the document. Geist is the stylesheet default,
 * so it clears the inline overrides and leaves styles.css / tokens.css in
 * charge; System sets `--vc-font-ui` and points the body font at it.
 */
export function applyViscosityAppearance(root?: HTMLElement): void {
  if (typeof document === "undefined") return;
  const target = root ?? document.documentElement;
  // `body` is still null when called from a <head> script.
  const body = target.ownerDocument.body as HTMLElement | null;
  const { uiFont } = useViscosityAppearance.getState();
  if (uiFont === "geist") {
    target.style.removeProperty("--vc-font-ui");
    delete target.dataset.vcUiFont;
    body?.style.removeProperty("font-family");
    return;
  }
  target.style.setProperty("--vc-font-ui", VISCOSITY_UI_FONT_STACKS[uiFont]);
  target.dataset.vcUiFont = uiFont;
  body?.style.setProperty("font-family", "var(--vc-font-ui)");
}

// Keep other windows of this app (same origin) in step when the pref changes.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== VISCOSITY_APPEARANCE_STORAGE_KEY) return;
    const next = readViscosityAppearancePrefs();
    if (next.uiFont === useViscosityAppearance.getState().uiFont) return;
    useViscosityAppearance.setState(next);
    applyViscosityAppearance();
  });
}
