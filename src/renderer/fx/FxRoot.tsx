/**
 * ViscosityCode: single mount point for fork visual effects in the desktop
 * main window — the animated background (Step 3) and agent-state effects
 * (Step 4). Renders nothing outside the fork's desktop shell.
 */
import { useViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import { AgentStateEffects } from "./agentState";
import { BackgroundLayer } from "./background";

export function FxRoot() {
  const shell = useViscosityShellFlag();
  if (!shell) return null;
  return (
    <>
      <BackgroundLayer />
      <AgentStateEffects />
    </>
  );
}
