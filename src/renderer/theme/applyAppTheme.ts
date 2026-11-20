// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
/**
 * Applies a theme preset's variant to the document root as inline CSS custom
 * properties. Inline properties win over the `.light` / `.dark` rules in
 * styles.css, so the base ("Viscosity") theme is expressed by *clearing* the
 * managed properties — letting styles.css stay the source of truth — rather
 * than by re-setting equivalent values.
 */

import { useSyncExternalStore } from "react";
import { normalizeCustomThemes, type CustomTheme } from "@/shared/customThemes";

import { resolveThemeMode } from "@/shared/themeMode";
import type { ThemeMode } from "@/shared/contracts";
import { DEFAULT_THEME_ID, getThemePreset, hasThemePreset, isDarkOnlyTheme } from "./themePresets";
import { MANAGED_THEME_VARS } from "./themeTokens";
// ViscosityCode: client-side appearance prefs (UI font) applied before mount.
import { applyViscosityAppearance } from "./viscosity/viscosityAppearanceStore";

type Appearance = "light" | "dark";

// ViscosityCode: a temporary preset shown instead of the saved one (a playbook's
// theme while its chat is on screen). Only the document root honours it; the
// saved setting and the boot cache keep the user's own theme.
let themeOverride: string | null = null;
let lastDocumentTheme: {
  root: HTMLElement;
  appearance: Appearance;
  themeId: string;
  customThemes: readonly CustomTheme[];
} | null = null;
const overrideListeners = new Set<() => void>();

export function applyAppTheme(
  root: HTMLElement,
  appearance: Appearance,
  themeId: string,
  customThemes: readonly CustomTheme[] = [],
): void {
  if (typeof document !== "undefined" && root === document.documentElement) {
    lastDocumentTheme = { root, appearance, themeId, customThemes };
    const effective = effectiveThemeId(themeOverride, themeId, customThemes);
    // ViscosityCode: a dark-only preset (Hostile Binary) shows dark whatever
    // the appearance setting; the caller's appearance is kept for restore.
    const shown = shownAppearance(appearance, effective);
    root.classList.toggle("dark", shown === "dark");
    root.classList.toggle("light", shown === "light");
    root.dataset.theme = shown;
    root.dataset.themePreset = effective;
    writeThemeVars(root, shown, effective, customThemes);
    return;
  }
  writeThemeVars(root, appearance, themeId, customThemes);
}

/**
 * ViscosityCode: show `themeId` instead of the saved theme until cleared with
 * `null`; re-applies the document theme at once (call inside a view transition's
 * update callback to animate it). Never writes settings.
 */
export function setAppThemeOverride(themeId: string | null): void {
  if (themeOverride === themeId) return;
  themeOverride = themeId;
  if (lastDocumentTheme) {
    const { root, appearance, themeId: saved, customThemes } = lastDocumentTheme;
    applyAppTheme(root, appearance, saved, customThemes);
  }
  for (const listener of overrideListeners) listener();
}

export function getAppThemeOverride(): string | null {
  return themeOverride;
}

function subscribeAppThemeOverride(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => overrideListeners.delete(listener);
}

/** The active theme override, for effects that re-read theme colours (Monaco, xterm). */
export function useAppThemeOverride(): string | null {
  return useSyncExternalStore(subscribeAppThemeOverride, getAppThemeOverride, () => null);
}

/**
 * ViscosityCode: the override the document is showing in place of the saved
 * theme, or null (none, or its preset is gone). For Settings to explain why a
 * theme choice is not on screen yet.
 */
export function useShownThemeOverride(customThemes: readonly CustomTheme[]): string | null {
  const override = useAppThemeOverride();
  return override && hasThemePreset(override, customThemes) ? override : null;
}

// An override whose preset is gone (a deleted custom theme) is ignored.
function effectiveThemeId(
  override: string | null,
  themeId: string,
  customThemes: readonly CustomTheme[],
): string {
  return override && hasThemePreset(override, customThemes) ? override : themeId;
}

function shownAppearance(appearance: Appearance, themeId: string): Appearance {
  return isDarkOnlyTheme(themeId) ? "dark" : appearance;
}

/**
 * ViscosityCode: the appearance the document actually shows for the saved
 * theme and the current override; dark for a dark-only preset. For the
 * appearance context Monaco and xterm read.
 */
export function useShownAppearance(
  appearance: Appearance,
  themeId: string,
  customThemes: readonly CustomTheme[],
): Appearance {
  const override = useAppThemeOverride();
  return shownAppearance(appearance, effectiveThemeId(override, themeId, customThemes));
}

function writeThemeVars(
  root: HTMLElement,
  appearance: Appearance,
  themeId: string,
  customThemes: readonly CustomTheme[],
): void {
  const preset = getThemePreset(themeId, customThemes);
  if (preset.id === DEFAULT_THEME_ID) {
    for (const key of MANAGED_THEME_VARS) {
      root.style.removeProperty(key);
    }
    return;
  }

  const vars = appearance === "dark" ? preset.dark : preset.light;
  for (const key of MANAGED_THEME_VARS) {
    // An empty value clears the declaration, letting the .light/.dark base win.
    root.style.setProperty(key, vars[key] ?? "");
  }
}

// Mirrors the localStorage key in sharedSettingsStore. Read directly here so the
// pre-paint bootstrap doesn't have to import (and eagerly hydrate) the store.
const SHARED_SETTINGS_CACHE_KEY = "poracode-shared-settings";

// Resolved appearance + background, read by the inline pre-paint script in
// index.html so the first frame matches the active theme. Keep the key in sync.
const BOOT_CACHE_KEY = "poracode-boot";

/**
 * Persists the resolved appearance + background so the next launch's pre-paint
 * bootstrap (index.html) can match the active theme before the renderer mounts.
 */
export function persistThemeBoot(
  appearance: Appearance,
  themeId: string,
  customThemes: readonly CustomTheme[] = [],
): void {
  try {
    const preset = getThemePreset(themeId, customThemes);
    const background = (appearance === "dark" ? preset.dark : preset.light)["--background"];
    localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ appearance, bg: background }));
  } catch {
    // Non-fatal; the bootstrap falls back to themeMode + system preference.
  }
}

/** Whether the OS currently prefers a dark color scheme (defaults to dark). */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Synchronously applies the cached appearance + theme to the document root
 * before React mounts, so a non-default theme doesn't flash the base palette on
 * launch. The authoritative settings load (provider effect) re-applies and wins
 * if the cache was stale. Defensive: never throws into the boot path.
 */
export function bootstrapAppThemeFromCache(): void {
  // ViscosityCode: apply the fork's client appearance prefs (UI font) first;
  // they do not depend on the shared-settings cache below.
  try {
    applyViscosityAppearance();
  } catch {
    // Never block boot on a fork preference.
  }
  try {
    const raw = localStorage.getItem(SHARED_SETTINGS_CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as {
      themeMode?: unknown;
      themePreset?: unknown;
      customThemes?: unknown;
    };
    const mode: ThemeMode =
      cached.themeMode === "light" || cached.themeMode === "system" ? cached.themeMode : "dark";
    const themeId = typeof cached.themePreset === "string" ? cached.themePreset : DEFAULT_THEME_ID;
    const appearance = resolveThemeMode(mode, systemPrefersDark());

    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(appearance);
    root.dataset.theme = appearance;
    root.dataset.themePreset = themeId;
    applyAppTheme(root, appearance, themeId, normalizeCustomThemes(cached.customThemes));
  } catch {
    // Ignore malformed cache; the provider effect applies real settings shortly.
  }
}
