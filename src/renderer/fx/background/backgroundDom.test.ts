import { afterEach, describe, expect, it } from "vitest";
import {
  applyBackgroundDom,
  BACKGROUND_ATTRIBUTE,
  BACKGROUND_BLUR_ATTRIBUTE,
  clearBackgroundDom,
  PANEL_ALPHA_VAR,
  PANEL_BLUR_VAR,
  panelStyleFor,
} from "./backgroundDom";

describe("background <html> state", () => {
  const root = document.documentElement;

  afterEach(() => clearBackgroundDom(root));

  it("turns translucent panels on with the panel opacity and blur", () => {
    applyBackgroundDom(root, { panelOpacity: 0.86, panelBlur: 18 });
    expect(root.getAttribute(BACKGROUND_ATTRIBUTE)).toBe("on");
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("0.86");
    expect(root.style.getPropertyValue(PANEL_BLUR_VAR)).toBe("18px");
    expect(root.hasAttribute(BACKGROUND_BLUR_ATTRIBUTE)).toBe(false);
  });

  it("updates in place when the settings change", () => {
    applyBackgroundDom(root, { panelOpacity: 0.86, panelBlur: 18 });
    applyBackgroundDom(root, { panelOpacity: 0.5, panelBlur: 6.25 });
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("0.5");
    expect(root.style.getPropertyValue(PANEL_BLUR_VAR)).toBe("6.3px");
  });

  it("skips the backdrop pass when blur is 0 or panels are opaque", () => {
    applyBackgroundDom(root, { panelOpacity: 0.7, panelBlur: 0 });
    expect(root.getAttribute(BACKGROUND_BLUR_ATTRIBUTE)).toBe("off");
    applyBackgroundDom(root, { panelOpacity: 1, panelBlur: 20 });
    expect(root.getAttribute(BACKGROUND_BLUR_ATTRIBUTE)).toBe("off");
    applyBackgroundDom(root, { panelOpacity: 0.7, panelBlur: 20 });
    expect(root.hasAttribute(BACKGROUND_BLUR_ATTRIBUTE)).toBe(false);
  });

  it("keeps panels readable: alpha never drops below 0.4, blur stays within 0..40px", () => {
    expect(panelStyleFor({ panelOpacity: 0.1, panelBlur: 99 })).toEqual({ alpha: 0.4, blurPx: 40 });
    expect(panelStyleFor({ panelOpacity: 3, panelBlur: -5 })).toEqual({ alpha: 1, blurPx: 0 });
    expect(panelStyleFor({ panelOpacity: Number.NaN, panelBlur: Number.NaN })).toEqual({
      alpha: 1,
      blurPx: 0,
    });
  });

  it("removes everything it set when cleared", () => {
    root.style.setProperty("--unrelated", "kept");
    applyBackgroundDom(root, { panelOpacity: 0.6, panelBlur: 0 });
    clearBackgroundDom(root);
    expect(root.hasAttribute(BACKGROUND_ATTRIBUTE)).toBe(false);
    expect(root.hasAttribute(BACKGROUND_BLUR_ATTRIBUTE)).toBe(false);
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("");
    expect(root.style.getPropertyValue(PANEL_BLUR_VAR)).toBe("");
    expect(root.style.getPropertyValue("--unrelated")).toBe("kept");
    root.style.removeProperty("--unrelated");
  });
});
