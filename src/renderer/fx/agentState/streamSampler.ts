/**
 * ViscosityCode: streaming-rate sampler for the Step 4 effects.
 *
 * No output rate is stored anywhere, so the monitor samples the length of each
 * visible thread's open assistant message a few times per second and keeps an
 * exponential moving average (characters per second). A sample that sees a
 * different item, or a shorter text, starts over from zero.
 */
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";

/** Sampling period; 4 Hz is the ceiling the effects are allowed. */
export const STREAM_SAMPLE_INTERVAL_MS = 250;
/** EMA time constant. */
export const STREAM_RATE_TAU_MS = 700;
/** Below this smoothed rate (chars/s) a thread no longer reads as streaming. */
export const STREAMING_MIN_RATE = 6;
/** Rate (chars/s) that maps to full energy. */
export const STREAM_RATE_FULL = 600;

/**
 * Source length of an item's assistant text. Long streams are kept as a
 * bounded projection; the elided count restores the true length so the rate
 * does not appear to drop when the projection trims its middle.
 */
export function readAssistantStreamLength(item: RuntimeChatItem | undefined): number {
  if (!item) return 0;
  const text = item.streams.assistant_text;
  const elided = item.streamRetention?.assistant_text?.elidedChars ?? 0;
  return (text?.length ?? 0) + elided;
}

/** Log-scaled 0..1 energy for a rate in chars/s. */
export function streamEnergyFromRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(1, Math.log1p(rate) / Math.log1p(STREAM_RATE_FULL));
}

interface SamplerEntry {
  itemId: string;
  length: number;
  at: number;
  rate: number;
}

export interface StreamRateSampler {
  /** Record a length sample; returns the smoothed rate in chars/s. */
  sample(key: string, itemId: string, length: number, now: number): number;
  /** The latest smoothed rate, 0 when unknown. */
  rate(key: string): number;
  forget(key: string): void;
  clear(): void;
  keys(): IterableIterator<string>;
}

export function createStreamRateSampler(tauMs: number = STREAM_RATE_TAU_MS): StreamRateSampler {
  const entries = new Map<string, SamplerEntry>();
  return {
    sample(key, itemId, length, now) {
      const entry = entries.get(key);
      if (!entry || entry.itemId !== itemId || length < entry.length) {
        // New item or a text that shrank (replacement, reload): new baseline.
        entries.set(key, { itemId, length, at: now, rate: 0 });
        return 0;
      }
      const dt = now - entry.at;
      if (dt <= 0) return entry.rate;
      const instant = ((length - entry.length) * 1000) / dt;
      const alpha = 1 - Math.exp(-dt / tauMs);
      entry.rate += alpha * (instant - entry.rate);
      if (entry.rate < 0.01) entry.rate = 0;
      entry.length = length;
      entry.at = now;
      return entry.rate;
    },
    rate(key) {
      return entries.get(key)?.rate ?? 0;
    },
    forget(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    keys() {
      return entries.keys();
    },
  };
}
