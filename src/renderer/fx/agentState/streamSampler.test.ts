import { describe, expect, it } from "vitest";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import {
  createStreamRateSampler,
  readAssistantStreamLength,
  STREAM_RATE_FULL,
  STREAM_SAMPLE_INTERVAL_MS,
  streamEnergyFromRate,
} from "./streamSampler";

describe("stream rate sampler", () => {
  it("starts at zero and converges on a steady rate", () => {
    const sampler = createStreamRateSampler();
    expect(sampler.sample("t", "a", 0, 0)).toBe(0);
    let rate = 0;
    // 50 chars every 250 ms = 200 chars/s.
    for (let step = 1; step <= 20; step += 1) {
      rate = sampler.sample("t", "a", step * 50, step * STREAM_SAMPLE_INTERVAL_MS);
    }
    expect(rate).toBeGreaterThan(190);
    expect(rate).toBeLessThanOrEqual(200);
    expect(sampler.rate("t")).toBe(rate);
  });

  it("smooths a burst instead of jumping to it", () => {
    const sampler = createStreamRateSampler();
    sampler.sample("t", "a", 0, 0);
    const rate = sampler.sample("t", "a", 100, 250); // instant 400 chars/s
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(400);
  });

  it("decays toward zero when the text stops growing", () => {
    const sampler = createStreamRateSampler();
    sampler.sample("t", "a", 0, 0);
    const busy = sampler.sample("t", "a", 200, 1000);
    let rate = busy;
    for (let step = 1; step <= 12; step += 1)
      rate = sampler.sample("t", "a", 200, 1000 + step * 250);
    expect(rate).toBeLessThan(busy / 10);
  });

  it("resets when the item changes", () => {
    const sampler = createStreamRateSampler();
    sampler.sample("t", "a", 0, 0);
    expect(sampler.sample("t", "a", 300, 500)).toBeGreaterThan(0);
    expect(sampler.sample("t", "b", 10, 750)).toBe(0);
    // The new item's first growth is measured from its own baseline.
    expect(sampler.sample("t", "b", 60, 1000)).toBeGreaterThan(0);
  });

  it("resets when the length drops", () => {
    const sampler = createStreamRateSampler();
    sampler.sample("t", "a", 0, 0);
    sampler.sample("t", "a", 500, 500);
    expect(sampler.sample("t", "a", 20, 750)).toBe(0);
    expect(sampler.rate("t")).toBe(0);
  });

  it("keeps threads independent and forgets on request", () => {
    const sampler = createStreamRateSampler();
    sampler.sample("x", "a", 0, 0);
    sampler.sample("y", "b", 0, 0);
    sampler.sample("x", "a", 100, 250);
    expect(sampler.rate("x")).toBeGreaterThan(0);
    expect(sampler.rate("y")).toBe(0);
    sampler.forget("x");
    expect(sampler.rate("x")).toBe(0);
    expect([...sampler.keys()]).toEqual(["y"]);
    sampler.clear();
    expect([...sampler.keys()]).toEqual([]);
  });

  it("ignores samples that do not advance time", () => {
    const sampler = createStreamRateSampler();
    sampler.sample("t", "a", 0, 100);
    expect(sampler.sample("t", "a", 50, 100)).toBe(0);
  });
});

describe("stream energy", () => {
  it("is log-scaled and clamped to 0..1", () => {
    expect(streamEnergyFromRate(0)).toBe(0);
    expect(streamEnergyFromRate(-5)).toBe(0);
    expect(streamEnergyFromRate(Number.NaN)).toBe(0);
    expect(streamEnergyFromRate(STREAM_RATE_FULL)).toBeCloseTo(1);
    expect(streamEnergyFromRate(STREAM_RATE_FULL * 10)).toBe(1);
    const slow = streamEnergyFromRate(20);
    const fast = streamEnergyFromRate(200);
    expect(slow).toBeGreaterThan(0.3);
    expect(fast).toBeGreaterThan(slow);
    // Log scale: a tenfold rate is far less than tenfold energy.
    expect(fast / slow).toBeLessThan(2);
  });
});

describe("readAssistantStreamLength", () => {
  it("adds the elided count of a bounded stream", () => {
    const item: RuntimeChatItem = {
      id: "a",
      type: "assistant_message",
      state: "updated",
      streams: { assistant_text: "hello" },
      streamRetention: {
        assistant_text: { headLimit: 10, headChars: 10, tailStart: 20, elidedChars: 1000 },
      },
    };
    expect(readAssistantStreamLength(item)).toBe(1005);
    const { streamRetention: _retention, ...plain } = item;
    expect(readAssistantStreamLength(plain)).toBe(5);
    expect(readAssistantStreamLength({ ...plain, streams: {} })).toBe(0);
    expect(readAssistantStreamLength(undefined)).toBe(0);
  });
});
