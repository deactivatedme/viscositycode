/**
 * ViscosityCode: whether this window's sound pack owns notification sounds
 * (Step 5). Kept tiny and audio-free because upstream `notifications.ts`
 * imports it to skip its own sound while the pack is on, so nothing plays
 * twice. The pack only runs where the agent-state effects run (the desktop
 * shell of the main window); elsewhere upstream's sound stays in charge.
 */
import { useFxSettings } from "@/renderer/fx/fxSettingsStore";

let runningPacks = 0;

/** Mark a running pack; returns its release (idempotent). */
export function markSoundPackRunning(): () => void {
  runningPacks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runningPacks -= 1;
  };
}

/** True while a pack runs in this window and the user has switched it on. */
export function isSoundPackHandlingSounds(): boolean {
  return runningPacks > 0 && useFxSettings.getState().sounds.enabled;
}
