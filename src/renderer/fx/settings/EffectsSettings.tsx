/**
 * ViscosityCode: Settings → Effects (Personal group, after Appearance).
 *
 * Configures the animated background (Step 3), agent-state effects (Step 4),
 * per-project backgrounds and the sound pack (Step 5) through `useFxSettings`,
 * a per-device view preference
 * (ARCHITECTURE_NOTES.md §8.6). Effects only render in the fork's desktop
 * shell (`html[data-vc-shell]`), so elsewhere the page says so instead of
 * hiding: the choices still apply when this device shows the desktop layout.
 *
 * Approval alerts are not a new setting: they are host-classified
 * notifications, so the row links to Settings → Notifications.
 */
import { Bell, RotateCcw } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useCompactLayout } from "@/renderer/adaptiveLayout";
import { isChatSidebarSurface } from "@/renderer/clientSurface";
import { Button } from "@/renderer/components/common";
import { DEFAULT_FX_SETTINGS, useFxSettings, type FxSettings } from "@/renderer/fx/fxSettingsStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { shouldEnableViscosityShell } from "@/renderer/viscosity/shellFlag";
import { SettingRow, SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { AgentEffectsSettings } from "./AgentEffectsSettings";
import { BackgroundEffectsSettings } from "./BackgroundEffectsSettings";
import { ProjectBackgroundSettings } from "./ProjectBackgroundSettings";
import { SoundEffectsSettings } from "./SoundEffectsSettings";

/** Whether this window shows effects: the same rule that sets `html[data-vc-shell]`. */
function useEffectsShownInThisWindow(): boolean {
  const compactLayout = useCompactLayout();
  return shouldEnableViscosityShell({
    windowKind: document.documentElement.dataset.windowKind,
    compactLayout,
    chatSidebarSurface: isChatSidebarSurface(),
  });
}

function matchesDefaults(settings: FxSettings): boolean {
  const sameGroup = <T extends object>(value: T, fallback: T) =>
    (Object.keys(fallback) as (keyof T)[]).every((key) => value[key] === fallback[key]);
  return (
    sameGroup(settings.background, DEFAULT_FX_SETTINGS.background) &&
    sameGroup(settings.effects, DEFAULT_FX_SETTINGS.effects) &&
    sameGroup(settings.sounds, DEFAULT_FX_SETTINGS.sounds) &&
    Object.keys(settings.projectBackgrounds).length === 0
  );
}

export function EffectsSettings() {
  const { t } = useLingui();
  const shownHere = useEffectsShownInThisWindow();
  const background = useFxSettings((state) => state.background);
  const effects = useFxSettings((state) => state.effects);
  const sounds = useFxSettings((state) => state.sounds);
  const projectBackgrounds = useFxSettings((state) => state.projectBackgrounds);
  const reset = useFxSettings((state) => state.reset);
  const openSettingsSection = usePanelStore((state) => state.openSettingsSection);
  // Mirrors what `showUserNotification` checks before alerting from the background.
  const approvalAlertsOn = useSharedSettings(
    (state) => state.notificationsEnabled && state.notificationStatuses.needsAttention !== false,
  );
  const atDefaults = matchesDefaults({ background, effects, sounds, projectBackgrounds });

  return (
    <SettingsPage
      title={t({
        message: "Effects",
        comment: "Settings section: animated background and live agent effects",
      })}
      description={t`Animated background and live agent effects. Saved on this device.`}
      bodyClassName="space-y-6"
    >
      {shownHere ? null : (
        <p role="note" className="rounded-lg border border-border px-3 py-2 text-xs text-muted">
          {t`Effects show only in the desktop layout of the main window, so they are off here. Your choices still apply wherever this device shows that layout.`}
        </p>
      )}

      <BackgroundEffectsSettings />

      <ProjectBackgroundSettings />

      <AgentEffectsSettings />

      <SoundEffectsSettings />

      <div className="space-y-4 border-t border-border pt-4">
        <SettingRow
          anchorId="effects.approvalNotifications"
          title={t`Notify me when an agent needs approval while the window is in the background`}
          description={t`Handled by your notification settings (Needs Attention), so you never get the same alert twice.`}
        >
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted">
              {approvalAlertsOn
                ? t({ message: "On", comment: "Effects settings: approval notifications are on" })
                : t({
                    message: "Off",
                    comment: "Effects settings: approval notifications are off",
                  })}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onPress={() =>
                openSettingsSection("notifications", "notifications.notifyNeedsAttention")
              }
            >
              <Bell className="size-3.5" />
              {t`Open notification settings`}
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          anchorId="effects.reset"
          title={t`Reset effects to defaults`}
          description={t`Restore every background and agent effect setting on this device.`}
        >
          <Button size="sm" variant="secondary" isDisabled={atDefaults} onPress={reset}>
            <RotateCcw className="size-3.5" />
            {t({ message: "Reset", comment: "Button: reset effects settings to defaults" })}
          </Button>
        </SettingRow>
      </div>
    </SettingsPage>
  );
}
