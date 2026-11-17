/**
 * ViscosityCode: a tiny, allocation-free channel from the agent-state monitor
 * (Step 4) to the background renderer (Step 3).
 *
 * The monitor publishes a smoothed "energy" level (0..1) derived from the
 * combined streaming output rate of visible agents. The renderer samples it
 * once per frame. Nothing here touches React, so streaming never triggers a
 * re-render through this path.
 */

let energy = 0;

/** Publish the current energy level (clamped to 0..1). */
export function setFxEnergy(value: number): void {
  energy = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Read the latest energy level. Cheap enough to call every frame. */
export function getFxEnergy(): number {
  return energy;
}
