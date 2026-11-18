/**
 * ViscosityCode: the "Background" group of Settings → Effects. Every control
 * writes `useFxSettings().background`; the rows under the master switch are
 * disabled while the animated background is off.
 */
import { useLingui } from "@lingui/react/macro";
import { Select, ToggleSwitch } from "@/renderer/components/common";
import {
  BACKGROUND_FPS_CAPS,
  BACKGROUND_PRESETS,
  useFxSettings,
  type BackgroundPreset,
} from "@/renderer/fx/fxSettingsStore";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { EffectsSettingsGroup, EffectsSlider } from "./EffectsSettingsControls";

const percent = (value: number) => `${value}%`;

export function BackgroundEffectsSettings() {
  const { t } = useLingui();
  const background = useFxSettings((state) => state.background);
  const setBackground = useFxSettings((state) => state.setBackground);
  const off = !background.enabled;

  const presetLabels: Record<BackgroundPreset, string> = {
    mesh: t`Gradient mesh`,
    particles: t`Particle field`,
    aurora: t`Aurora grid`,
  };
  const presetOptions = BACKGROUND_PRESETS.map((preset) => ({
    id: preset,
    label: presetLabels[preset],
  }));
  const fpsOptions = BACKGROUND_FPS_CAPS.map((fps) => ({
    id: String(fps),
    label: t`${fps} fps`,
  }));

  return (
    <EffectsSettingsGroup
      title={t({ message: "Background", comment: "Settings → Effects group heading" })}
      description={t`An animated backdrop behind the app, drawn under translucent panels.`}
      disabled={off}
      lead={
        <SettingRow
          anchorId="effects.background"
          title={t`Animated background`}
          description={t`Draw a slow, animated backdrop behind the app's panels.`}
        >
          <ToggleSwitch
            aria-label={t`Animated background`}
            isSelected={background.enabled}
            onChange={(selected) => setBackground({ enabled: selected })}
          />
        </SettingRow>
      }
    >
      <SettingRow
        anchorId="effects.backgroundStyle"
        title={t`Style`}
        description={t`The look of the animated background.`}
      >
        <Select
          aria-label={t`Background style`}
          className="w-[160px] shrink-0"
          options={presetOptions}
          value={background.preset}
          isDisabled={off}
          onChange={(value) => {
            const preset = BACKGROUND_PRESETS.find((id) => id === value);
            if (preset) setBackground({ preset });
          }}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.backgroundIntensity"
        title={t`Intensity`}
        description={t`Brightness, contrast, and speed of the background.`}
      >
        <EffectsSlider
          aria-label={t`Background intensity`}
          minValue={0}
          maxValue={100}
          step={5}
          value={Math.round(background.intensity * 100)}
          isDisabled={off}
          formatValue={percent}
          onChange={(value) => setBackground({ intensity: value / 100 })}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.fpsCap"
        title={t`Frame-rate cap`}
        description={t`Highest frame rate for the background. Lower values use less power.`}
      >
        <Select
          aria-label={t`Frame-rate cap`}
          className="w-[160px] shrink-0"
          options={fpsOptions}
          value={String(background.fpsCap)}
          isDisabled={off}
          onChange={(value) => {
            const fpsCap = BACKGROUND_FPS_CAPS.find((fps) => String(fps) === value);
            if (fpsCap) setBackground({ fpsCap });
          }}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.panelOpacity"
        title={t`Panel opacity`}
        description={t`How solid panels look over the background. Lower shows more of it.`}
      >
        <EffectsSlider
          aria-label={t`Panel opacity`}
          minValue={40}
          maxValue={100}
          step={2}
          value={Math.round(background.panelOpacity * 100)}
          isDisabled={off}
          formatValue={percent}
          onChange={(value) => setBackground({ panelOpacity: value / 100 })}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.panelBlur"
        title={t`Panel blur`}
        description={t`How much the background is blurred behind panels.`}
      >
        <EffectsSlider
          aria-label={t`Panel blur`}
          minValue={0}
          maxValue={40}
          step={1}
          value={Math.round(background.panelBlur)}
          isDisabled={off}
          formatValue={(value) => t`${value} px`}
          onChange={(value) => setBackground({ panelBlur: value })}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.pauseWhenUnfocused"
        title={t`Pause when the window is not focused`}
        description={t`Stop animating while you work in another app.`}
      >
        <ToggleSwitch
          aria-label={t`Pause when the window is not focused`}
          isSelected={background.pauseWhenUnfocused}
          isDisabled={off}
          onChange={(selected) => setBackground({ pauseWhenUnfocused: selected })}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.respectReducedMotion"
        title={t`Pause when the system asks to reduce motion`}
        description={t`Off by default, so the background keeps animating even with Reduce Motion on in macOS or animation effects off in Windows.`}
      >
        <ToggleSwitch
          aria-label={t`Pause when the system asks to reduce motion`}
          isSelected={background.respectReducedMotion}
          isDisabled={off}
          onChange={(selected) => setBackground({ respectReducedMotion: selected })}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.batterySaver"
        title={t`Battery saver`}
        description={t`Slow the background down on battery power and stop it when the battery is low.`}
      >
        <ToggleSwitch
          aria-label={t`Battery saver`}
          isSelected={background.batterySaver}
          isDisabled={off}
          onChange={(selected) => setBackground({ batterySaver: selected })}
        />
      </SettingRow>
    </EffectsSettingsGroup>
  );
}
