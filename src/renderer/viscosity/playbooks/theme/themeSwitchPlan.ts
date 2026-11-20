/**
 * ViscosityCode: which theme a playbook asks for. Pure, so precedence and the
 * toggle are testable.
 */
import type { CustomTheme } from "@/shared/customThemes";
import type { ThreadPlaybookBinding } from "@/shared/viscosity/playbook";
import { hasThemePreset } from "@/renderer/theme/themePresets";

/** The preset to show for this playbook, or null to keep the user's theme. */
export function playbookThemeOverride(
  binding: ThreadPlaybookBinding | undefined,
  allowed: boolean,
  customThemes: readonly CustomTheme[],
): string | null {
  const themeId = binding?.themeId;
  if (!allowed || !themeId) return null;
  return hasThemePreset(themeId, customThemes) ? themeId : null;
}
