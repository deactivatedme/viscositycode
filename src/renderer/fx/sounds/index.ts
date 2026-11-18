/**
 * ViscosityCode: the sound pack (Step 5) — short synthesized cues when an
 * agent finishes, hits an error or needs your approval. Off by default.
 *
 * `startSoundPack` runs alongside the agent-state effects (desktop shell of
 * the main window). While it runs and is switched on, upstream's single
 * notification sound is skipped (`isSoundPackHandlingSounds`), so every event
 * makes at most one sound. Settings previews share the same player and gate.
 */
import { onAgentFxTransition } from "@/renderer/fx/agentState/transitions";
import { useFxSettings, type SoundCue } from "@/renderer/fx/fxSettingsStore";
import { createCuePlayer, type CuePlayer } from "./cuePlayer";
import type { CueGate } from "./cuePolicy";
import { createSoundPack } from "./soundPack";
import { markSoundPackRunning } from "./soundPackState";
import { isAppInFront, isThreadOnScreen } from "./visibility";

export { isSoundPackHandlingSounds } from "./soundPackState";
export { CUE_MIN_GAP_MS } from "./cuePolicy";

const gate: CueGate = { lastPlayedAt: null };
let player: CuePlayer | null = null;

function getPlayer(): CuePlayer {
  player ??= createCuePlayer();
  return player;
}

/** Start listening for agent transitions; returns the stop. */
export function startSoundPack(): () => void {
  const pack = createSoundPack({
    subscribe: onAgentFxTransition,
    getSettings: () => useFxSettings.getState().sounds,
    isAppInFront: () => isAppInFront(),
    isThreadOnScreen,
    play: (cue, volume) => getPlayer().play(cue, volume),
    gate,
    now: () => performance.now(),
  });
  pack.start();
  const release = markSoundPackRunning();
  return () => {
    pack.stop();
    release();
  };
}

/**
 * Play a cue now at the current volume, from a user gesture (Settings
 * previews). Works with the pack switched off so a cue can be heard first.
 */
export function previewSoundCue(cue: SoundCue): boolean {
  gate.lastPlayedAt = performance.now();
  return getPlayer().play(cue, useFxSettings.getState().sounds.volume);
}
