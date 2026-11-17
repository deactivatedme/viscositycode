import { WindowMaterialSetting } from "@/renderer/viscosity/windowMaterial/WindowMaterialSetting";

/**
 * ViscosityCode: fork-only rows rendered at the bottom of Settings → Appearance
 * (window material, background, …). Upstream's AppearanceSettings renders this
 * slot once; fork features add their rows here so the upstream file stays
 * nearly untouched. Each row decides its own visibility (platform, client).
 */
export function ViscosityAppearanceExtras() {
  return <WindowMaterialSetting />;
}
