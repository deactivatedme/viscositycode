/**
 * ViscosityCode: the "Per-project backgrounds" group of Settings → Effects
 * (Step 5). Each project can override the background's style and intensity;
 * "Global" and an untouched slider follow the Background group above, and the
 * reset button drops the project's override. Disabled projects are not listed.
 */
import { RotateCcw } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import { Button, Select } from "@/renderer/components/common";
import {
  BACKGROUND_PRESETS,
  useFxSettings,
  type BackgroundPreset,
  type ProjectBackgroundOverride,
} from "@/renderer/fx/fxSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { EffectsSettingsGroup, EffectsSlider } from "./EffectsSettingsControls";

const GLOBAL_OPTION = "global";

function ProjectBackgroundRow(props: {
  project: Project;
  override: ProjectBackgroundOverride | undefined;
  presetLabels: Record<BackgroundPreset, string>;
  globalPreset: BackgroundPreset;
  globalIntensity: number;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const setProjectBackground = useFxSettings((state) => state.setProjectBackground);
  const clearProjectBackground = useFxSettings((state) => state.clearProjectBackground);
  const { project, override, presetLabels } = props;
  const name = project.name;
  const globalLabel = presetLabels[props.globalPreset];
  const intensityOverridden = override?.intensity !== undefined;

  const styleOptions = [
    {
      id: GLOBAL_OPTION,
      label: t({
        message: `Global (${globalLabel})`,
        comment: "Per-project background style: follow the global style, named in parentheses",
      }),
    },
    ...BACKGROUND_PRESETS.map((preset) => ({ id: preset, label: presetLabels[preset] })),
  ];

  return (
    <SettingRow
      title={name}
      description={
        override ? t`This project has its own background.` : t`Follows the global background.`
      }
    >
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Select
          aria-label={t`Background style for ${name}`}
          className="w-[170px] shrink-0"
          options={styleOptions}
          value={override?.preset ?? GLOBAL_OPTION}
          isDisabled={props.disabled}
          onChange={(value) => {
            const preset = BACKGROUND_PRESETS.find((id) => id === value);
            setProjectBackground(project.id, { preset: preset ?? null });
          }}
        />
        <EffectsSlider
          aria-label={t`Background intensity for ${name}`}
          className="w-[150px]"
          minValue={0}
          maxValue={100}
          step={5}
          value={Math.round((override?.intensity ?? props.globalIntensity) * 100)}
          isDisabled={props.disabled}
          formatValue={(value) =>
            intensityOverridden
              ? `${value}%`
              : t({
                  message: `Global · ${value}%`,
                  comment: "Per-project background intensity that follows the global setting",
                })
          }
          onChange={(value) => setProjectBackground(project.id, { intensity: value / 100 })}
        />
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="h-7 w-7 min-w-7"
          aria-label={t`Reset the background for ${name}`}
          isDisabled={!override}
          onPress={() => clearProjectBackground(project.id)}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
    </SettingRow>
  );
}

export function ProjectBackgroundSettings() {
  const { t } = useLingui();
  const projects = useAppStore((state) => state.projects);
  const enabled = useFxSettings((state) => state.background.enabled);
  const globalPreset = useFxSettings((state) => state.background.preset);
  const globalIntensity = useFxSettings((state) => state.background.intensity);
  const overrides = useFxSettings((state) => state.projectBackgrounds);
  const listed = projects.filter((project) => !project.disabled);

  const presetLabels: Record<BackgroundPreset, string> = {
    mesh: t`Gradient mesh`,
    particles: t`Particle field`,
    aurora: t`Aurora grid`,
  };

  return (
    <EffectsSettingsGroup
      anchorId="effects.projectBackgrounds"
      title={t`Per-project backgrounds`}
      description={t`Give a project its own background style or intensity. It applies while that project's thread or draft is in focus; other projects use the settings above.`}
      disabled={!enabled}
    >
      {listed.length === 0 ? (
        <p className="text-xs text-muted">{t`No projects yet.`}</p>
      ) : (
        <div role="list" aria-label={t`Per-project backgrounds`} className="space-y-4">
          {listed.map((project) => (
            <div role="listitem" key={project.id}>
              <ProjectBackgroundRow
                project={project}
                override={Object.hasOwn(overrides, project.id) ? overrides[project.id] : undefined}
                presetLabels={presetLabels}
                globalPreset={globalPreset}
                globalIntensity={globalIntensity}
                disabled={!enabled}
              />
            </div>
          ))}
        </div>
      )}
    </EffectsSettingsGroup>
  );
}
