import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundEnvironment, isOpaqueCssColor } from "./environment";

describe("BackgroundEnvironment focus", () => {
  const environments: BackgroundEnvironment[] = [];

  function create() {
    const onChange = vi.fn<() => void>();
    const environment = new BackgroundEnvironment(onChange, { coverCheck: () => false });
    environments.push(environment);
    return { environment, onChange };
  }

  afterEach(() => {
    for (const environment of environments.splice(0)) environment.dispose();
    document.documentElement.removeAttribute("data-app-unfocused");
    vi.restoreAllMocks();
  });

  it("treats a blur toward another app as unfocused", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { environment, onChange } = create();
    expect(environment.snapshot().windowFocused).toBe(true);

    hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(onChange).toHaveBeenCalled();
    expect(environment.snapshot().windowFocused).toBe(false);

    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(environment.snapshot().windowFocused).toBe(true);
  });

  it("stays focused when focus moves into an embedded frame of this window", () => {
    // The document still has a focused descendant (iframe / webview), so
    // hasFocus() is true even though the window itself fired `blur`.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { environment } = create();
    window.dispatchEvent(new Event("blur"));
    expect(environment.snapshot().windowFocused).toBe(true);
  });

  it("follows upstream's html[data-app-unfocused] as well", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { environment } = create();
    document.documentElement.setAttribute("data-app-unfocused", "");
    expect(environment.snapshot().windowFocused).toBe(false);
  });
});

describe("isOpaqueCssColor", () => {
  it("reads alpha from modern and legacy colour syntax", () => {
    expect(isOpaqueCssColor("rgb(10, 10, 11)")).toBe(true);
    expect(isOpaqueCssColor("oklch(0.14 0 0)")).toBe(true);
    expect(isOpaqueCssColor("rgba(0, 0, 0, 0)")).toBe(false);
    expect(isOpaqueCssColor("oklch(0.14 0 0 / 0.5)")).toBe(false);
    expect(isOpaqueCssColor("transparent")).toBe(false);
  });
});
