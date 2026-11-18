/**
 * ViscosityCode: palette commands for the animated background and the
 * agent-state effects. They write the same client preferences as
 * Settings → Effects (`useFxSettings`), so the page and the palette always
 * agree. The toggles are offered only in the desktop shell, where the effects
 * render; "Open Effects settings" works wherever Settings shows the page.
 *
 * "Cycle background style" changes the style that is on screen: when the
 * project in focus has its own style (Settings → Effects → Per-project
 * backgrounds) it cycles that project's style, otherwise the global one.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { selectBackgroundProjectId } from "@/renderer/fx/background/projectBackground";
import {
  BACKGROUND_PRESETS,
  type BackgroundPreset,
  useFxSettings,
} from "@/renderer/fx/fxSettingsStore";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import {
  isSettingsSectionOffered,
  offeredWhen,
  openSettingsSectionIfOffered,
  VISCOSITY_COMMAND_GROUP,
} from "./commandSupport";

/** Same names as the Background style picker in Settings → Effects. */
const BACKGROUND_PRESET_LABELS: Record<BackgroundPreset, MessageDescriptor> = {
  mesh: msg`Gradient mesh`,
  particles: msg`Particle field`,
  aurora: msg`Aurora grid`,
};

/** The style after `current`, wrapping around (mesh → particles → aurora → mesh). */
export function nextBackgroundPreset(current: BackgroundPreset): BackgroundPreset {
  const index = BACKGROUND_PRESETS.indexOf(current);
  return BACKGROUND_PRESETS[(index + 1) % BACKGROUND_PRESETS.length] ?? "mesh";
}

export function toggleAnimatedBackground(): void {
  const { background, setBackground } = useFxSettings.getState();
  setBackground({ enabled: !background.enabled });
}

/** Which style "Cycle background style" changes: one project's own style, or the global one. */
export type BackgroundStyleTarget =
  | { scope: "project"; projectId: string; preset: BackgroundPreset }
  | { scope: "global"; preset: BackgroundPreset };

/**
 * The style on screen and where it comes from: the project in focus when its
 * per-project override sets a style (the same project the background layer
 * resolves), otherwise the global setting. An override of the intensity alone
 * follows the global style, so cycling the global style is what shows there.
 */
export function backgroundStyleTarget(): BackgroundStyleTarget {
  const { background, projectBackgrounds } = useFxSettings.getState();
  const projectId = selectBackgroundProjectId(useAppStore.getState());
  const projectPreset =
    projectId !== undefined && Object.hasOwn(projectBackgrounds, projectId)
      ? projectBackgrounds[projectId]?.preset
      : undefined;
  if (projectId !== undefined && projectPreset !== undefined) {
    return { scope: "project", projectId, preset: projectPreset };
  }
  return { scope: "global", preset: background.preset };
}

/** Switch the style on screen to the next one; a background that is off turns on so the change shows. */
export function cycleBackgroundStyle(): void {
  const target = backgroundStyleTarget();
  const next = nextBackgroundPreset(target.preset);
  const { background, setBackground, setProjectBackground } = useFxSettings.getState();
  if (target.scope === "project") {
    setProjectBackground(target.projectId, { preset: next });
    if (!background.enabled) setBackground({ enabled: true });
    return;
  }
  setBackground({ preset: next, enabled: true });
}

export function toggleAgentEffects(): void {
  const { effects, setEffects } = useFxSettings.getState();
  setEffects({ enabled: !effects.enabled });
}

/**
 * Only where the effects render (the desktop shell). A keybinding pressed in a
 * secondary window (thread pop-out, side chat) would write a preference the
 * main window neither shows nor reloads, and its next save would undo it.
 */
function inShell(action: () => void): () => void {
  return () => {
    if (isViscosityShellActive()) action();
  };
}

export function effectsCommands(): AppCommand[] {
  const shell = offeredWhen(isViscosityShellActive());
  const { background, effects } = useFxSettings.getState();
  const styleTarget = backgroundStyleTarget();
  const nextStyle = i18n._(BACKGROUND_PRESET_LABELS[nextBackgroundPreset(styleTarget.preset)]);
  return [
    {
      id: VISCOSITY_COMMAND_IDS.toggleBackground,
      title: msg`Toggle animated background`,
      subtitle: background.enabled
        ? msg`Turn the animated background off`
        : msg`Turn the animated background on`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["background", "animated", "effects", "wallpaper", "motion"],
      ...shell,
      run: inShell(toggleAnimatedBackground),
    },
    {
      id: VISCOSITY_COMMAND_IDS.cycleBackgroundStyle,
      title: msg`Cycle background style`,
      subtitle:
        styleTarget.scope === "project"
          ? msg`Switch this project to ${nextStyle}`
          : msg`Switch to ${nextStyle}`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["background", "style", "preset", "mesh", "particles", "aurora", "effects"],
      ...shell,
      run: inShell(cycleBackgroundStyle),
    },
    {
      id: VISCOSITY_COMMAND_IDS.toggleAgentEffects,
      title: msg`Toggle agent effects`,
      subtitle: effects.enabled ? msg`Turn agent effects off` : msg`Turn agent effects on`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["effects", "glow", "thinking", "streaming", "agent", "animation"],
      ...shell,
      run: inShell(toggleAgentEffects),
    },
    {
      id: VISCOSITY_COMMAND_IDS.openEffectsSettings,
      title: msg`Open Effects settings`,
      subtitle: msg`Animated background and agent effects`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["effects", "background", "settings", "preferences", "animation"],
      ...offeredWhen(isSettingsSectionOffered("effects")),
      run: () => openSettingsSectionIfOffered("effects"),
    },
  ];
}
