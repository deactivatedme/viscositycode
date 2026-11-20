/**
 * ViscosityCode Mission Control: the center-panel mount (fork of Poracode).
 * Rendered by the fork's center frame inside the desktop shell only; the
 * panel loads lazily the first time it opens. The view sync (step aside when
 * the user opens a thread, the editor or a Roundtable) is
 * installed here, outside React's render path.
 *
 * When the shell turns off (the window shrinks to the compact layout), the
 * panel closes for good: unmounting it releases the panes it made inert, and
 * clearing `shown` keeps it from coming back over whatever the user opened
 * meanwhile once the window widens again.
 */
import { lazy, Suspense, useEffect } from "react";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import {
  closeMissionControl,
  selectMissionControlShown,
  startMissionControlViewSync,
  useMissionControlViewStore,
} from "../missionControlViewStore";

const loadPanel = () =>
  import("./MissionControlPanel").then((module) => ({ default: module.MissionControlPanel }));

const MissionControlPanel = lazy(loadPanel);

/** Warm the panel's chunk (activity bar hover/focus). */
export function preloadMissionControlPanel(): void {
  void loadPanel();
}

export function MissionControlHost() {
  const enabled = useViscosityShellEnabled();
  const shown = useMissionControlViewStore(selectMissionControlShown);
  useEffect(() => {
    if (!enabled) {
      closeMissionControl();
      return undefined;
    }
    const stopViewSync = startMissionControlViewSync();
    return () => {
      stopViewSync();
      // The shell turned off, or the center frame dropped this host (it does
      // so in the compact layout): the panel cannot show without its host.
      closeMissionControl();
    };
  }, [enabled]);
  if (!enabled || !shown) return null;
  return (
    <Suspense fallback={null}>
      <MissionControlPanel />
    </Suspense>
  );
}
