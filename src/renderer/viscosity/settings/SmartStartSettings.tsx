import { useLingui } from "@lingui/react/macro";
import { EffectsSettingsGroup } from "@/renderer/fx/settings/EffectsSettingsControls";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import { SmartStartPreferencesEditor } from "@/renderer/viscosity/smartStart";

/**
 * ViscosityCode: the "Smart start" group at the bottom of Settings → Agents ·
 * General: which providers Auto favours for coding work and for quick
 * questions. Auto only runs in the desktop layout's new-thread composer, so
 * the group shows only where that layout does; the same editor also opens
 * from the composer's Auto row. The lists are saved on this device.
 */
export function SmartStartSettings() {
  const { t } = useLingui();
  const shell = useViscosityShellEnabled();
  if (!shell) return null;
  return (
    <EffectsSettingsGroup
      title={t`Smart start`}
      description={t`Auto starts new threads on the ready account with the most usage left. These lists break close calls by what the prompt looks like.`}
    >
      <SmartStartPreferencesEditor />
    </EffectsSettingsGroup>
  );
}
