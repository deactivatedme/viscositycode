import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLiveTurnText,
  clearSessionLiveText,
  LIGHTWEIGHT_LIVE_TEXT_INTERVAL_MS,
  LIVE_TEXT_INTERVAL_MS,
  liveTurnKey,
  setLiveTurnText,
  useRoundtableLiveText,
} from "./liveText";
import { usePerformanceSettings } from "@/renderer/viscosity/performance/performanceSettingsStore";

function read(sessionId: string, turnId: string): string | undefined {
  return useRoundtableLiveText.getState().textByTurn[liveTurnKey(sessionId, turnId)];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  clearSessionLiveText("s");
  usePerformanceSettings.getState().setLightweight("auto");
  vi.useRealTimers();
});

describe("live turn text", () => {
  it("publishes at most every interval and keeps the latest text", () => {
    const writes = vi.fn<() => void>();
    const unsubscribe = useRoundtableLiveText.subscribe(writes);
    setLiveTurnText("s", "t", "a", Date.now());
    setLiveTurnText("s", "t", "ab", Date.now());
    setLiveTurnText("s", "t", "abc", Date.now());
    expect(read("s", "t")).toBe("a");
    vi.advanceTimersByTime(LIVE_TEXT_INTERVAL_MS);
    expect(read("s", "t")).toBe("abc");
    expect(writes).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("publishes less often in lightweight mode", () => {
    usePerformanceSettings.getState().setLightweight("on");
    setLiveTurnText("s", "t", "a", Date.now());
    setLiveTurnText("s", "t", "ab", Date.now());
    vi.advanceTimersByTime(LIVE_TEXT_INTERVAL_MS);
    expect(read("s", "t")).toBe("a");
    vi.advanceTimersByTime(LIGHTWEIGHT_LIVE_TEXT_INTERVAL_MS - LIVE_TEXT_INTERVAL_MS);
    expect(read("s", "t")).toBe("ab");
  });

  it("clears one turn or a whole session", () => {
    setLiveTurnText("s", "t1", "one", Date.now());
    setLiveTurnText("s", "t2", "two", Date.now());
    setLiveTurnText("other", "t3", "three", Date.now());
    clearLiveTurnText("s", "t1");
    expect(read("s", "t1")).toBeUndefined();
    clearSessionLiveText("s");
    expect(read("s", "t2")).toBeUndefined();
    expect(read("other", "t3")).toBe("three");
    clearSessionLiveText("other");
  });
});
