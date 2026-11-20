/**
 * ViscosityCode: Settings → Appearance note shown while a playbook's theme is
 * on screen instead of the saved one, so picking a theme there never looks
 * like it did nothing. One click turns playbook themes off on this device.
 */
import { useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useShownThemeOverride } from "@/renderer/theme/applyAppTheme";
import { getThemePreset } from "@/renderer/theme/themePresets";
import { setPlaybookViewPrefs } from "../viewPrefs";

export function PlaybookThemeNote() {
  const { t } = useLingui();
  const themePreset = useSharedSettings((state) => state.themePreset);
  const customThemes = useSharedSettings((state) => state.customThemes);
  const override = useShownThemeOverride(customThemes);
  if (!override || override === themePreset) return null;
  const label = getThemePreset(override, customThemes).label;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
    >
      <p className="min-w-0 text-xs text-muted">
        {t`The playbook on screen is showing ${label}. Your theme comes back when you leave that chat.`}
      </p>
      <Button
        size="sm"
        variant="tertiary"
        className="shrink-0"
        onPress={() => setPlaybookViewPrefs({ themeOverride: false })}
      >
        {t`Turn off playbook themes`}
      </Button>
    </div>
  );
}
