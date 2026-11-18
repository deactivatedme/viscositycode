/**
 * ViscosityCode: plays the sound pack's cues with WebAudio (Step 5).
 *
 * The AudioContext is created lazily on the first cue (never at start-up) and
 * suspended again after a few idle seconds, so a quiet app holds no running
 * audio thread. Each tone is one oscillator through its own envelope into a
 * per-cue master gain; nodes disconnect themselves when they end.
 */
import type { SoundCue } from "@/renderer/fx/fxSettingsStore";
import { CUE_TONES, cueDuration } from "./cues";

/** Loudest master gain, at volume 1. Tones peak below 0.5, so cues never clip. */
export const MAX_CUE_GAIN = 0.9;
/** Idle time after a cue ends before the context is suspended. */
export const IDLE_SUSPEND_MS = 4000;
/**
 * A cue that waited longer than this for the context to wake is dropped: a
 * browser may hold a context asleep until the next click, and a late cue (or
 * a queued burst of them) would sound out of context.
 */
export const MAX_WAKE_DELAY_MS = 1000;
const ATTACK_S = 0.012;
const START_DELAY_S = 0.02;
const SILENT = 0.0001;

type Timer = ReturnType<typeof setTimeout>;

/** Perceptual volume curve: 0..1 slider to master gain. */
export function volumeToGain(volume: number): number {
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  return MAX_CUE_GAIN * v * v;
}

export interface CuePlayer {
  /** Schedule a cue at this volume; false when it cannot sound (no audio, volume 0). */
  play(cue: SoundCue, volume: number): boolean;
  /** Close the audio context. The player can still play again afterwards. */
  dispose(): void;
}

export interface CuePlayerOptions {
  createContext?: () => AudioContext | null;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (handle: Timer) => void;
  now?: () => number;
}

function createDefaultContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export function createCuePlayer(options: CuePlayerOptions = {}): CuePlayer {
  const createContext = options.createContext ?? createDefaultContext;
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: Timer) => clearTimeout(handle));
  const now = options.now ?? (() => performance.now());

  let context: AudioContext | null = null;
  let unavailable = false;
  let idleTimer: Timer | null = null;
  let suspending: Promise<void> | null = null;
  // At most one cue waits for the context to wake; others meanwhile are dropped.
  let waking = false;

  function ensureContext(): AudioContext | null {
    if (context && context.state !== "closed") return context;
    if (unavailable) return null;
    try {
      context = createContext();
    } catch {
      context = null;
    }
    if (!context) unavailable = true;
    return context;
  }

  function clearIdle(): void {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = null;
  }

  function armIdleSuspend(ctx: AudioContext, afterSeconds: number): void {
    clearIdle();
    idleTimer = setTimer(
      () => {
        idleTimer = null;
        if (ctx !== context || ctx.state !== "running") return;
        suspending = ctx
          .suspend()
          .catch(() => undefined)
          .finally(() => {
            suspending = null;
          });
      },
      afterSeconds * 1000 + IDLE_SUSPEND_MS,
    );
  }

  function schedule(ctx: AudioContext, cue: SoundCue, volume: number): void {
    if (ctx !== context || ctx.state !== "running") return;
    const start = ctx.currentTime + START_DELAY_S;
    const master = ctx.createGain();
    master.gain.setValueAtTime(volumeToGain(volume), start);
    master.connect(ctx.destination);
    const tones = CUE_TONES[cue];
    let pending = tones.length;
    for (const tone of tones) {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const toneStart = start + tone.at;
      const toneEnd = toneStart + tone.length;
      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
      if (tone.glideTo !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(tone.glideTo, toneEnd);
      }
      envelope.gain.setValueAtTime(SILENT, toneStart);
      envelope.gain.exponentialRampToValueAtTime(tone.level, toneStart + ATTACK_S);
      envelope.gain.exponentialRampToValueAtTime(SILENT, toneEnd);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.addEventListener(
        "ended",
        () => {
          oscillator.disconnect();
          envelope.disconnect();
          pending -= 1;
          if (pending === 0) master.disconnect();
        },
        { once: true },
      );
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + START_DELAY_S);
    }
    armIdleSuspend(ctx, START_DELAY_S + cueDuration(cue));
  }

  return {
    play(cue, volume) {
      if (!(volumeToGain(volume) > 0)) return false;
      const ctx = ensureContext();
      if (!ctx) return false;
      clearIdle();
      if (ctx.state === "running" && !suspending) {
        schedule(ctx, cue, volume);
        return true;
      }
      // Wait out a suspend in flight, then wake the context (a browser may
      // keep it asleep until the user interacts; the cue is then dropped).
      if (waking) return false;
      waking = true;
      const requestedAt = now();
      void (suspending ?? Promise.resolve())
        .then(() => (ctx.state === "running" ? undefined : ctx.resume()))
        .then(() => {
          if (now() - requestedAt <= MAX_WAKE_DELAY_MS) schedule(ctx, cue, volume);
        })
        .catch(() => undefined)
        .finally(() => {
          waking = false;
        });
      return true;
    },
    dispose() {
      clearIdle();
      const ctx = context;
      context = null;
      unavailable = false;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    },
  };
}
