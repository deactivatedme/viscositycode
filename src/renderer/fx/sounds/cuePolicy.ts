/**
 * ViscosityCode: when a sound pack cue may play (Step 5). Pure, so the rules
 * are testable without audio:
 *
 * 1. the pack and that cue are switched on, and the volume is above zero;
 * 2. the user is not already looking at it: the app is not in front, or the
 *    thread is not on screen — unless "Also when the app is in front" is on;
 * 3. at most one cue per `CUE_MIN_GAP_MS`, whichever kind it is, so a burst
 *    of agents finishing together makes one sound, not a chord.
 */
import type { SoundCue, SoundSettings } from "@/renderer/fx/fxSettingsStore";

export const CUE_MIN_GAP_MS = 1500;

export interface CueSituation {
  /** The window is visible and focused. */
  readonly appInFront: boolean;
  /** The thread is shown in a pane of this window. */
  readonly threadOnScreen: boolean;
}

export type CueDecision = "play" | "pack-off" | "cue-off" | "muted" | "on-screen" | "throttled";

/** Shared between the pack and the settings previews so they also respect each other. */
export interface CueGate {
  lastPlayedAt: number | null;
}

export function isThrottled(gate: CueGate, now: number): boolean {
  return gate.lastPlayedAt !== null && now - gate.lastPlayedAt < CUE_MIN_GAP_MS;
}

export function decideCue(
  settings: SoundSettings,
  cue: SoundCue,
  situation: CueSituation,
  gate: CueGate,
  now: number,
): CueDecision {
  if (!settings.enabled) return "pack-off";
  if (!settings[cue]) return "cue-off";
  if (!(settings.volume > 0)) return "muted";
  if (!settings.alsoInFront && situation.appInFront && situation.threadOnScreen) {
    return "on-screen";
  }
  if (isThrottled(gate, now)) return "throttled";
  return "play";
}
