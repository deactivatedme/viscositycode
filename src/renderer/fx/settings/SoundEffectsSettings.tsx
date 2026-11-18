/**
 * ViscosityCode: the "Sounds" group of Settings → Effects (Step 5). The sound
 * pack is off by default; while it is on it replaces the notification sound.
 * "Play" previews work even with the pack off, so a cue can be heard before
 * switching it on, and use the current volume.
 */
import { Play } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { Button, ToggleSwitch } from "@/renderer/components/common";
import { useFxSettings, type SoundCue, type SoundSettings } from "@/renderer/fx/fxSettingsStore";
import { previewSoundCue } from "@/renderer/fx/sounds";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { EffectsSettingsGroup, EffectsSlider } from "./EffectsSettingsControls";

const percent = (value: number) => `${value}%`;

function cueSwitchPatch(cue: SoundCue, selected: boolean): Partial<SoundSettings> {
  const patch: Partial<SoundSettings> = {};
  patch[cue] = selected;
  return patch;
}

export function SoundEffectsSettings() {
  const { t } = useLingui();
  const sounds = useFxSettings((state) => state.sounds);
  const setSounds = useFxSettings((state) => state.setSounds);
  const off = !sounds.enabled;

  // `anchorId` stays a literal on each row so the settings-search drift check can find it.
  const cues: {
    cue: SoundCue;
    anchorId: string;
    title: string;
    description: string;
    playLabel: string;
  }[] = [
    {
      cue: "done",
      anchorId: "effects.soundDone",
      title: t`Agent finished`,
      description: t`A soft rising chime when an agent finishes its turn.`,
      playLabel: t`Play the finished sound`,
    },
    {
      cue: "error",
      anchorId: "effects.soundError",
      title: t`Agent error`,
      description: t`Two low, falling notes when an agent hits an error.`,
      playLabel: t`Play the error sound`,
    },
    {
      cue: "attention",
      anchorId: "effects.soundAttention",
      title: t`Needs your approval`,
      description: t`A gentle double tap when an agent waits for your approval or reply.`,
      playLabel: t`Play the approval sound`,
    },
  ];

  return (
    <EffectsSettingsGroup
      title={t({ message: "Sounds", comment: "Settings → Effects group heading" })}
      description={t`Short synthesized sounds for agent events. Off by default.`}
      disabled={off}
      lead={
        <SettingRow
          anchorId="effects.sounds"
          title={t`Sound cues`}
          description={t`Play a short sound when an agent finishes, hits an error, or needs your approval. While on, these replace the notification sound.`}
        >
          <ToggleSwitch
            aria-label={t`Sound cues`}
            isSelected={sounds.enabled}
            onChange={(selected) => setSounds({ enabled: selected })}
          />
        </SettingRow>
      }
    >
      <SettingRow
        anchorId="effects.soundVolume"
        title={t`Volume`}
        description={t`How loud the sound cues play.`}
      >
        <EffectsSlider
          aria-label={t`Sound cue volume`}
          minValue={0}
          maxValue={100}
          step={5}
          value={Math.round(sounds.volume * 100)}
          isDisabled={off}
          formatValue={percent}
          onChange={(value) => setSounds({ volume: value / 100 })}
        />
      </SettingRow>

      <SettingRow
        anchorId="effects.soundAlsoInFront"
        title={t`Also when the app is in front`}
        description={t`Otherwise cues play only while the app is in the background or the thread is not on screen.`}
      >
        <ToggleSwitch
          aria-label={t`Also when the app is in front`}
          isSelected={sounds.alsoInFront}
          isDisabled={off}
          onChange={(selected) => setSounds({ alsoInFront: selected })}
        />
      </SettingRow>

      {cues.map((row) => (
        <SettingRow
          key={row.cue}
          anchorId={row.anchorId}
          title={row.title}
          description={row.description}
        >
          <div className="flex shrink-0 items-center gap-2">
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="h-7 w-7 min-w-7"
              aria-label={row.playLabel}
              onPress={() => previewSoundCue(row.cue)}
            >
              <Play className="size-3.5" />
            </Button>
            <ToggleSwitch
              aria-label={row.title}
              isSelected={sounds[row.cue]}
              isDisabled={off}
              onChange={(selected) => setSounds(cueSwitchPatch(row.cue, selected))}
            />
          </div>
        </SettingRow>
      ))}
    </EffectsSettingsGroup>
  );
}
