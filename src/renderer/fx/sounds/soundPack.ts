/**
 * ViscosityCode: the sound pack runtime (Step 5). Listens to agent
 * transitions, asks `decideCue` whether to sound, and hands approved cues to
 * the player. Dependencies are injected so the rules run in tests without
 * audio, stores or a window.
 */
import type { SoundCue, SoundSettings } from "@/renderer/fx/fxSettingsStore";
import type {
  AgentFxTransition,
  AgentFxTransitionKind,
} from "@/renderer/fx/agentState/transitions";
import { type CueDecision, type CueGate, decideCue } from "./cuePolicy";

const CUE_FOR_TRANSITION: Readonly<Record<AgentFxTransitionKind, SoundCue>> = {
  done: "done",
  error: "error",
  attention: "attention",
};

export interface SoundPackDeps {
  subscribe(listener: (transition: AgentFxTransition) => void): () => void;
  getSettings(): SoundSettings;
  isAppInFront(): boolean;
  isThreadOnScreen(threadId: string): boolean;
  play(cue: SoundCue, volume: number): boolean;
  gate: CueGate;
  now(): number;
}

export interface SoundPack {
  start(): void;
  stop(): void;
  /** Decide (and maybe play) one transition; exposed for tests. */
  handle(transition: AgentFxTransition): CueDecision;
}

export function createSoundPack(deps: SoundPackDeps): SoundPack {
  let unsubscribe: (() => void) | null = null;

  function handle(transition: AgentFxTransition): CueDecision {
    const settings = deps.getSettings();
    // Cheap exit while off (the default): no store or document reads.
    if (!settings.enabled) return "pack-off";
    const cue = CUE_FOR_TRANSITION[transition.kind];
    const now = deps.now();
    const decision = decideCue(
      settings,
      cue,
      {
        appInFront: deps.isAppInFront(),
        threadOnScreen: deps.isThreadOnScreen(transition.threadId),
      },
      deps.gate,
      now,
    );
    if (decision !== "play") return decision;
    // Count the slot even if audio is unavailable, so a failing device never retries in a burst.
    deps.gate.lastPlayedAt = now;
    deps.play(cue, settings.volume);
    return decision;
  }

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = deps.subscribe((transition) => {
        handle(transition);
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
    },
    handle,
  };
}
