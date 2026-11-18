import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CaretPoint,
  installTypingGlow,
  RIPPLE_CLASS,
  RIPPLE_MIN_INTERVAL_MS,
  TYPING_ATTRIBUTE,
  TYPING_HOLD_MS,
} from "./typingGlow";

function buildComposer() {
  const shell = document.createElement("div");
  shell.className = "poracode-composer-shell";
  const input = document.createElement("div");
  input.className = "poracode-mention-input";
  input.setAttribute("contenteditable", "true");
  const line = document.createElement("p");
  input.append(line);
  shell.append(input);
  const other = document.createElement("textarea");
  document.body.replaceChildren(shell, other);
  return { shell, input, line, other };
}

function harness() {
  let clock = 0;
  const frames: (() => void)[] = [];
  const timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
  const readCaret = vi.fn<(doc: Document, input: Element) => CaretPoint | null>(() => ({
    x: 120.4,
    y: 40.6,
  }));
  const uninstall = installTypingGlow({
    document,
    now: () => clock,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: (handle) => {
      frames[handle - 1] = () => {};
    },
    setTimer: (callback, ms) => {
      const timer = { at: clock + ms, callback, cancelled: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      (handle as unknown as { cancelled: boolean }).cancelled = true;
    },
    readCaret,
  });
  return {
    uninstall,
    readCaret,
    frames,
    timers,
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue;
        if (timer.at <= clock) timer.callback();
        else timers.push(timer);
      }
    },
    runFrames() {
      for (const callback of frames.splice(0)) callback();
    },
  };
}

function type(target: Element): void {
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

const ripple = () => document.querySelector<HTMLElement>(`.${RIPPLE_CLASS}`);

let active: ReturnType<typeof harness> | null = null;

afterEach(() => {
  active?.uninstall();
  active = null;
  document.body.replaceChildren();
});

describe("composer typing glow", () => {
  it("marks the composer surface while typing and clears it after the hold", () => {
    const { shell, line } = buildComposer();
    active = harness();
    type(line);
    expect(shell.hasAttribute(TYPING_ATTRIBUTE)).toBe(true);
    active.advance(TYPING_HOLD_MS - 100);
    type(line);
    active.advance(150);
    // The second keystroke extended the hold.
    expect(shell.hasAttribute(TYPING_ATTRIBUTE)).toBe(true);
    active.advance(TYPING_HOLD_MS);
    expect(shell.hasAttribute(TYPING_ATTRIBUTE)).toBe(false);
  });

  it("keeps a single hold timer however fast keys arrive", () => {
    const { line } = buildComposer();
    active = harness();
    for (let key = 0; key < 25; key += 1) {
      type(line);
      active.advance(10);
    }
    expect(active.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
  });

  it("ignores input outside the composer", () => {
    const { shell, other } = buildComposer();
    active = harness();
    type(other);
    expect(shell.hasAttribute(TYPING_ATTRIBUTE)).toBe(false);
    expect(active.frames).toHaveLength(0);
  });

  it("reads the caret in one frame and moves the ripple in the next", () => {
    const { line } = buildComposer();
    active = harness();
    type(line);
    expect(active.readCaret).not.toHaveBeenCalled();
    active.runFrames();
    expect(active.readCaret).toHaveBeenCalledTimes(1);
    expect(ripple()).toBeNull();
    active.runFrames();
    const element = ripple()!;
    expect(element.style.transform).toBe("translate3d(120px, 41px, 0)");
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("data-vc-ripple")).toBe("a");
  });

  it("throttles ripples and alternates the animation phase", () => {
    const { line } = buildComposer();
    active = harness();
    type(line);
    active.runFrames();
    active.runFrames();
    // Within the interval: no new caret read.
    active.advance(RIPPLE_MIN_INTERVAL_MS / 2);
    type(line);
    type(line);
    expect(active.frames).toHaveLength(0);
    active.advance(RIPPLE_MIN_INTERVAL_MS);
    type(line);
    active.runFrames();
    active.runFrames();
    expect(active.readCaret).toHaveBeenCalledTimes(2);
    expect(ripple()!.getAttribute("data-vc-ripple")).toBe("b");
  });

  it("does not stack caret reads while one is pending", () => {
    const { line } = buildComposer();
    active = harness();
    type(line);
    active.advance(RIPPLE_MIN_INTERVAL_MS * 2);
    type(line);
    expect(active.frames).toHaveLength(1);
  });

  it("skips the ripple when the caret cannot be measured", () => {
    const { line } = buildComposer();
    active = harness();
    active.readCaret.mockReturnValueOnce(null);
    type(line);
    active.runFrames();
    expect(active.frames).toHaveLength(0);
    expect(ripple()).toBeNull();
  });

  it("uninstall removes the listener, the attribute and the ripple", () => {
    const { shell, line } = buildComposer();
    active = harness();
    type(line);
    active.runFrames();
    active.runFrames();
    active.uninstall();
    expect(shell.hasAttribute(TYPING_ATTRIBUTE)).toBe(false);
    expect(ripple()).toBeNull();
    type(line);
    expect(shell.hasAttribute(TYPING_ATTRIBUTE)).toBe(false);
    active = null;
  });
});
