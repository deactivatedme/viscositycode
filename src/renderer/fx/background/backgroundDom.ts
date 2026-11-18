/**
 * ViscosityCode: the <html> attributes and CSS variables that switch the
 * desktop shell's panels to translucent while the background runs
 * (background.css keys off them).
 */
import type { BackgroundSettings } from "../fxSettingsStore";

export const BACKGROUND_ATTRIBUTE = "data-vc-bg";
/** "off" when backdrop blur would be invisible or useless (0 px, opaque panels). */
export const BACKGROUND_BLUR_ATTRIBUTE = "data-vc-bg-blur";
export const PANEL_ALPHA_VAR = "--vc-panel-alpha";
export const PANEL_BLUR_VAR = "--vc-panel-blur";

/** Readability floor for panels over the background (matches the settings clamp). */
export const MIN_PANEL_ALPHA = 0.4;
export const MAX_PANEL_BLUR_PX = 40;

type PanelSettings = Pick<BackgroundSettings, "panelOpacity" | "panelBlur">;

export interface PanelStyle {
  alpha: number;
  blurPx: number;
}

export function panelStyleFor(settings: PanelSettings): PanelStyle {
  const alpha = Number.isFinite(settings.panelOpacity) ? settings.panelOpacity : 1;
  const blur = Number.isFinite(settings.panelBlur) ? settings.panelBlur : 0;
  return {
    alpha: Math.round(Math.min(1, Math.max(MIN_PANEL_ALPHA, alpha)) * 1000) / 1000,
    blurPx: Math.round(Math.min(MAX_PANEL_BLUR_PX, Math.max(0, blur)) * 10) / 10,
  };
}

/** Turn the translucent-panel mode on with the given panel opacity and blur. */
export function applyBackgroundDom(root: HTMLElement, settings: PanelSettings): void {
  const { alpha, blurPx } = panelStyleFor(settings);
  root.setAttribute(BACKGROUND_ATTRIBUTE, "on");
  root.style.setProperty(PANEL_ALPHA_VAR, String(alpha));
  root.style.setProperty(PANEL_BLUR_VAR, `${blurPx}px`);
  if (blurPx <= 0 || alpha >= 1) root.setAttribute(BACKGROUND_BLUR_ATTRIBUTE, "off");
  else root.removeAttribute(BACKGROUND_BLUR_ATTRIBUTE);
}

/** Back to upstream's opaque panels (tokens.css defaults apply again). */
export function clearBackgroundDom(root: HTMLElement): void {
  root.removeAttribute(BACKGROUND_ATTRIBUTE);
  root.removeAttribute(BACKGROUND_BLUR_ATTRIBUTE);
  root.style.removeProperty(PANEL_ALPHA_VAR);
  root.style.removeProperty(PANEL_BLUR_VAR);
}
