/**
 * ViscosityCode: the "Agent effects" group of Settings → Effects. The master
 * switch writes `effects.enabled`; each per-effect switch is disabled (and
 * dimmed) while the master is off, but keeps its own value for when it is
 * turned back on.
 */
import { useLingui } from "@lingui/react/macro";
import { ToggleSwitch } from "@/renderer/components/common";
import { useFxSettings, type EffectsSettings } from "@/renderer/fx/fxSettingsStore";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { EffectsSettingsGroup } from "./EffectsSettingsControls";

type EffectKey = Exclude<keyof EffectsSettings, "enabled">;

export function AgentEffectsSettings() {
  const { t } = useLingui();
  const effects = useFxSettings((state) => state.effects);
  const setEffects = useFxSettings((state) => state.setEffects);
  const off = !effects.enabled;

  // `anchorId` stays a literal on each row so the settings-search drift check
  // can find it, as it does for upstream sections.
  const rows: { key: EffectKey; anchorId: string; title: string; description: string }[] = [
    {
      key: "thinkingGlow",
      anchorId: "effects.thinkingGlow",
      title: t`Thinking glow`,
      description: t`A soft pulse while an agent is reasoning.`,
    },
    {
      key: "streamingEnergy",
      anchorId: "effects.streamingEnergy",
      title: t`Streaming energy`,
      description: t`The background picks up while an agent streams a reply.`,
    },
    {
      key: "toolIndicator",
      anchorId: "effects.toolIndicator",
      title: t`Tool activity indicator`,
      description: t`Marks threads that are running a tool or command.`,
    },
    {
      key: "attentionColor",
      anchorId: "effects.attentionColor",
      title: t`Attention color when an agent needs you`,
      description: t`Highlights threads that are waiting for your approval or reply.`,
    },
    {
      key: "errorFlash",
      anchorId: "effects.errorFlash",
      title: t`Error flash`,
      description: t`A brief flash when an agent hits an error.`,
    },
    {
      key: "completionAnimation",
      anchorId: "effects.completionAnimation",
      title: t`Completion animation`,
      description: t`A short animation when an agent finishes its turn.`,
    },
    {
      key: "typingGlow",
      anchorId: "effects.typingGlow",
      title: t`Typing glow`,
      description: t`The composer glows softly while you type.`,
    },
  ];

  return (
    <EffectsSettingsGroup
      title={t`Agent activity`}
      description={t`Effects that show what each agent is doing on its thread, its tab, and the background.`}
      disabled={off}
      lead={
        <SettingRow
          anchorId="effects.agentEffects"
          title={t`Agent effects`}
          description={t`Show live effects for what agents are doing. Turn off to hide them all.`}
        >
          <ToggleSwitch
            aria-label={t`Agent effects`}
            isSelected={effects.enabled}
            onChange={(selected) => setEffects({ enabled: selected })}
          />
        </SettingRow>
      }
    >
      {rows.map((row) => (
        <SettingRow
          key={row.key}
          anchorId={row.anchorId}
          title={row.title}
          description={row.description}
        >
          <ToggleSwitch
            aria-label={row.title}
            isSelected={effects[row.key]}
            isDisabled={off}
            onChange={(selected) => setEffects({ [row.key]: selected })}
          />
        </SettingRow>
      ))}
    </EffectsSettingsGroup>
  );
}
