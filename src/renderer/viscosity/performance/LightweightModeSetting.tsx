/**
 * ViscosityCode: the Lightweight mode row at the end of Settings → Appearance.
 * Lightweight mode trades looks for memory, GPU and power (./lightweight.ts).
 */
import { useLingui } from "@lingui/react/macro";
import { Select } from "@/renderer/components/common";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import { isLowMemoryDevice, useLightweightActive } from "./lightweight";
import {
  LIGHTWEIGHT_MODES,
  usePerformanceSettings,
  type LightweightMode,
} from "./performanceSettingsStore";

export function LightweightModeSetting() {
  const { t } = useLingui();
  const mode = usePerformanceSettings((state) => state.lightweight);
  const setLightweight = usePerformanceSettings((state) => state.setLightweight);
  const active = useLightweightActive();
  const shell = useViscosityShellEnabled();

  const modeLabels: Record<LightweightMode, string> = {
    auto: t`Auto (on for 8 GB of memory or less)`,
    on: t({ message: "On", comment: "Lightweight mode option" }),
    off: t({ message: "Off", comment: "Lightweight mode option" }),
  };

  // Auto also turns on for graphics (Windows/Linux), which the option label
  // does not name, so the status says which rule fired.
  let status = active ? t`On for this device` : t`Off for this device`;
  if (active && mode === "auto") {
    status = isLowMemoryDevice()
      ? t`On for this device: 8 GB of memory or less`
      : t`On for this device: no usable GPU, or a Remote Desktop session`;
  }

  return (
    <SettingRow
      anchorId="appearance.lightweight"
      title={t`Lightweight mode`}
      description={
        // Glass and animation changes key off html[data-vc-lightweight], set only in the desktop layout.
        shell
          ? t`Uses less memory, GPU and power on this device: no window glass, fewer animations, and lighter caching of background chats.`
          : t`Uses less memory on this device with lighter caching of background chats. Window glass and animations change only in the desktop layout.`
      }
    >
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Select
          aria-label={t`Lightweight mode`}
          className="w-[260px] shrink-0"
          options={LIGHTWEIGHT_MODES.map((id) => ({ id, label: modeLabels[id] }))}
          value={mode}
          onChange={(value) => {
            const next = LIGHTWEIGHT_MODES.find((id) => id === value);
            if (next) setLightweight(next);
          }}
        />
        <span className="text-xs text-muted">{status}</span>
      </div>
    </SettingRow>
  );
}
