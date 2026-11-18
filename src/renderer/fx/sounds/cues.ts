/**
 * ViscosityCode: the sound pack's cues (Step 5), written as a few synthesized
 * tones each — no audio files, so nothing to license or ship. Every cue is
 * short (under a second), soft-edged, and has its own contour so it can be
 * told apart without looking:
 *
 * - done: a rising two-note chime with a faint bell partial (resolves upward);
 * - error: two falling triangle notes, the second drooping slightly (low, not harsh);
 * - attention: a gentle double tap on one pitch, the second softer (asks, does not alarm).
 */
import type { SoundCue } from "@/renderer/fx/fxSettingsStore";

export interface CueTone {
  /** Seconds after the cue starts. */
  readonly at: number;
  /** Starting pitch, Hz. */
  readonly frequency: number;
  /** Pitch the tone slides to by its end, Hz. */
  readonly glideTo?: number;
  /** Seconds from the tone's start until it has faded out. */
  readonly length: number;
  readonly wave: "sine" | "triangle";
  /** Peak level 0..1 before the master volume. */
  readonly level: number;
}

// Equal temperament, A4 = 440 Hz.
const C_SHARP_5 = 554.37;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;

export const CUE_TONES: Readonly<Record<SoundCue, readonly CueTone[]>> = {
  done: [
    { at: 0, frequency: G5, length: 0.42, wave: "sine", level: 0.45 },
    { at: 0, frequency: G5 * 2, length: 0.18, wave: "sine", level: 0.05 },
    { at: 0.12, frequency: C6, length: 0.62, wave: "sine", level: 0.45 },
    { at: 0.12, frequency: C6 * 2, length: 0.28, wave: "sine", level: 0.05 },
  ],
  error: [
    { at: 0, frequency: E5, length: 0.26, wave: "triangle", level: 0.4 },
    {
      at: 0.17,
      frequency: C_SHARP_5,
      glideTo: C_SHARP_5 * 0.97,
      length: 0.46,
      wave: "triangle",
      level: 0.4,
    },
  ],
  attention: [
    { at: 0, frequency: A5, length: 0.16, wave: "sine", level: 0.36 },
    { at: 0.17, frequency: A5, length: 0.24, wave: "sine", level: 0.28 },
  ],
};

/** Seconds from a cue's start until its last tone has faded. */
export function cueDuration(cue: SoundCue): number {
  let end = 0;
  for (const tone of CUE_TONES[cue]) end = Math.max(end, tone.at + tone.length);
  return end;
}
