import { afterEach, describe, expect, it, vi } from "vitest";
import { installZenEscapeListener, isZenExitEscape } from "./zenEscape";

function pressEscape(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** A focusable input inside a wrapper carrying `attributes`. */
function inputInside(attributes: Record<string, string>): HTMLInputElement {
  const wrapper = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) wrapper.setAttribute(name, value);
  const input = document.createElement("input");
  wrapper.append(input);
  document.body.append(wrapper);
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isZenExitEscape", () => {
  function event(overrides: Partial<Parameters<typeof isZenExitEscape>[0]> = {}) {
    return {
      key: "Escape",
      defaultPrevented: false,
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      target: document.body,
      ...overrides,
    };
  }

  it("accepts a bare, unclaimed Escape", () => {
    expect(isZenExitEscape(event())).toBe(true);
  });

  it.each([
    ["another key", { key: "Enter" }],
    ["a claimed Escape", { defaultPrevented: true }],
    ["IME composition", { isComposing: true }],
    ["auto-repeat", { repeat: true }],
    ["Alt", { altKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
    ["Shift", { shiftKey: true }],
  ])("ignores %s", (_name, overrides) => {
    expect(isZenExitEscape(event(overrides))).toBe(false);
  });

  it.each([
    ["a terminal", { class: "xterm" }],
    ["an editor", { class: "monaco-editor" }],
    ["a dialog", { role: "dialog" }],
    ["a menu", { role: "menu" }],
    ["an escape owner", { "data-overlay-escape-owner": "" }],
  ])("leaves Escape to %s", (_name, attributes) => {
    expect(isZenExitEscape(event({ target: inputInside(attributes) }))).toBe(false);
  });
});

describe("installZenEscapeListener", () => {
  it("exits after the dispatch when nobody claimed Escape", () => {
    vi.useFakeTimers();
    try {
      const onExit = vi.fn<() => void>();
      const dispose = installZenEscapeListener(window, { onExit });
      pressEscape(document.body);
      expect(onExit).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(onExit).toHaveBeenCalledTimes(1);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a listener registered later claim Escape first", () => {
    const pending: Array<() => void> = [];
    const onExit = vi.fn<() => void>();
    const dispose = installZenEscapeListener(window, {
      onExit,
      defer: (callback) => pending.push(callback),
    });
    const claim = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", claim);
    pressEscape(document.body);
    for (const callback of pending) callback();
    expect(onExit).not.toHaveBeenCalled();
    window.removeEventListener("keydown", claim);
    dispose();
  });

  it("never sees an Escape an overlay stopped in the capture phase", () => {
    const onExit = vi.fn<() => void>();
    const dispose = installZenEscapeListener(window, { onExit, defer: (callback) => callback() });
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    window.addEventListener("keydown", stop, { capture: true });
    pressEscape(document.body);
    expect(onExit).not.toHaveBeenCalled();
    window.removeEventListener("keydown", stop, { capture: true });
    dispose();
  });

  it("ignores other keys and stops listening once disposed", () => {
    const pending: Array<() => void> = [];
    const onExit = vi.fn<() => void>();
    const dispose = installZenEscapeListener(window, {
      onExit,
      defer: (callback) => pending.push(callback),
    });
    pressEscape(document.body, { key: "a" });
    expect(pending).toHaveLength(0);

    pressEscape(document.body);
    dispose();
    for (const callback of pending) callback();
    pressEscape(document.body);
    expect(onExit).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1);
  });
});
