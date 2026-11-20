/**
 * ViscosityCode: the fork's runtime in the desktop main window. Renders
 * nothing. Only while the desktop shell flag is on, it:
 * - sets `html[data-vc-lightweight]` while Lightweight mode is active, which
 *   swaps endless animations for still stand-ins;
 * - registers the fork's "is this thread on screen?" rule for upstream's
 *   notifications (Roundtable, Mission Control, Zen and side chat);
 * - starts agent activity (the "N tools running" status item).
 * Compact/PWA, thread windows and the extension keep upstream behaviour.
 */
import { useEffect } from "react";
import { startAgentActivity } from "@/renderer/viscosity/agentActivity";
import { useLightweightActive } from "@/renderer/viscosity/performance/lightweight";
import { useViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import { isThreadOnScreen } from "@/renderer/viscosity/threadOnScreen";
import { setThreadOnScreenOverride } from "@/renderer/viscosity/threadVisibilityHook";

export const LIGHTWEIGHT_ATTRIBUTE = "data-vc-lightweight";

export function ViscosityShellRuntime(): null {
  const shell = useViscosityShellFlag();
  const lightweight = useLightweightActive();

  useEffect(() => {
    if (!shell || !lightweight) return;
    const root = document.documentElement;
    root.setAttribute(LIGHTWEIGHT_ATTRIBUTE, "");
    return () => root.removeAttribute(LIGHTWEIGHT_ATTRIBUTE);
  }, [shell, lightweight]);

  useEffect(() => {
    if (!shell) return;
    const unregisterOnScreen = setThreadOnScreenOverride(isThreadOnScreen);
    const stopAgentActivity = startAgentActivity();
    return () => {
      stopAgentActivity();
      unregisterOnScreen();
    };
  }, [shell]);

  return null;
}
