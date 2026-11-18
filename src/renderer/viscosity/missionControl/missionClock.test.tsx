import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSecondClock } from "./missionClock";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function Clock() {
  return <span data-testid="clock">{useSecondClock()}</span>;
}

const shown = () => Number(screen.getByTestId("clock").textContent);

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
  // Fall back to jsdom's own getter.
  Reflect.deleteProperty(document, "visibilityState");
});

describe("useSecondClock", () => {
  it("ticks every second, rests while the window is hidden and catches up when it shows", () => {
    const view = render(<Clock />);
    expect(shown()).toBe(1_000_000);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(shown()).toBe(1_001_000);
    expect(vi.getTimerCount()).toBe(1);

    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(shown()).toBe(1_001_000);

    setVisibility("visible");
    // The elapsed time is current right away, without waiting a second.
    expect(shown()).toBe(1_031_000);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(shown()).toBe(1_032_000);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    // Unmounted: a later visibility change starts nothing.
    setVisibility("hidden");
    setVisibility("visible");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start ticking for a timer mounted while the window is hidden", () => {
    visibility = "hidden";
    const view = render(<Clock />);
    expect(shown()).toBe(1_000_000);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    setVisibility("visible");
    expect(shown()).toBe(1_005_000);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
