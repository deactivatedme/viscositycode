import { AgentColorsSettings } from "@/renderer/viscosity/agentColors/AgentColorsSettings";
import { LightweightModeSetting } from "@/renderer/viscosity/performance/LightweightModeSetting";
import { WindowMaterialSetting } from "@/renderer/viscosity/windowMaterial/WindowMaterialSetting";

/**
 * ViscosityCode: fork-only rows rendered at the bottom of Settings → Appearance
 * (window material, agent colours, Lightweight mode, …). Upstream's AppearanceSettings renders
 * this slot once; fork features add their rows here so the upstream file stays
 * nearly untouched. Each row decides its own visibility (platform, client).
 */
export function ViscosityAppearanceExtras() {
  return (
    <>
      <WindowMaterialSetting />
      <AgentColorsSettings />
      <LightweightModeSetting />
    </>
  );
}
