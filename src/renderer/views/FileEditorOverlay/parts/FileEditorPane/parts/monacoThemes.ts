// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { useEffect } from "react";
import type { Monaco } from "@monaco-editor/react";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useResolvedAppearance } from "@/renderer/components/ui/provider";
import { resolveTerminalColor } from "@/renderer/components/terminal/terminalColors";
import {
  buildMonacoThemeData,
  MONACO_THEME_CSS_VARS,
  type MonacoThemeColors,
} from "@/renderer/theme/viscosity/monacoThemeData";

/** Stable theme names the editor body passes to Monaco. */
export const MONACO_THEME_NAMES = {
  dark: "poracode-dark",
  light: "poracode-light",
} as const;

// ViscosityCode: the Monaco instance whose themes follow the app theme. Monaco
// themes are global, so one instance (the shared loader's) is enough.
let themedMonaco: Monaco | null = null;

/** Read the active theme's CSS variables as Monaco-parseable colours. */
function readMonacoThemeColors(): MonacoThemeColors | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const styles = window.getComputedStyle(document.documentElement);
  const colors: MonacoThemeColors = {};
  for (const [key, cssVar] of Object.entries(MONACO_THEME_CSS_VARS) as [
    keyof MonacoThemeColors,
    string,
  ][]) {
    colors[key] = resolveTerminalColor(styles.getPropertyValue(cssVar).trim());
  }
  return colors;
}

function activeAppearance(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

/**
 * Define the app's Monaco themes from the active theme's resolved CSS
 * variables (ViscosityCode: previously fixed hex values). The editor
 * background stays transparent so the parent's `var(--content-background)`
 * shows through. The active appearance's theme is built from live CSS; the
 * other one gets Viscosity fallbacks until it becomes active and is redefined.
 * Redefining the current theme makes Monaco repaint it in place.
 */
export function defineAppThemes(monaco: Monaco, appearance: "light" | "dark" = activeAppearance()) {
  themedMonaco = monaco;
  const inactive = appearance === "dark" ? "light" : "dark";
  monaco.editor.defineTheme(MONACO_THEME_NAMES[inactive], buildMonacoThemeData(inactive, null));
  monaco.editor.defineTheme(
    MONACO_THEME_NAMES[appearance],
    buildMonacoThemeData(appearance, readMonacoThemeColors()),
  );
}

/**
 * The resolved light/dark appearance for the editor. ViscosityCode: follows the
 * app's resolved appearance (so OS flips in "system" mode apply live) and
 * redefines the Monaco themes whenever the appearance, preset or active custom
 * theme changes.
 */
export function useResolvedTheme(): "light" | "dark" {
  const appearance = useResolvedAppearance();
  const themePreset = useSharedSettings((s) => s.themePreset);
  const activeCustomTheme = useSharedSettings((s) =>
    s.customThemes.find((theme) => theme.id === s.themePreset),
  );

  // AppProvider rewrites the theme CSS variables in its own (parent) effect,
  // which runs after this child effect; wait a frame to read fresh values.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (themedMonaco) defineAppThemes(themedMonaco, appearance);
    });
    return () => cancelAnimationFrame(frame);
    // The preset and active custom theme change the CSS variables read inside
    // defineAppThemes, so they must retrigger the redefinition.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [appearance, themePreset, activeCustomTheme]);

  return appearance;
}
