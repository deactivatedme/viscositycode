/**
 * ViscosityCode: lets the playbook of the chat on screen (the focused pane's
 * thread or new-chat draft, or a panel covering the panes such as the
 * Roundtable view, see coverPlaybookTheme.ts) recolour the app. While that playbook names a theme and "Let
 * playbooks change the theme" is on, the document shows that preset through
 * `setAppThemeOverride`; the saved theme setting is never written, so leaving
 * the chat restores the user's theme. The switch is instant.
 *
 * Mounted once by the desktop shell's center frame; renders nothing.
 */
import { useEffect } from "react";
import { parseDraftProjectId } from "@/shared/paneId";
import { threadPlaybookBinding } from "@/shared/viscosity/playbook";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getProjectMap, getThreadMap } from "@/renderer/state/useThread";
import { setAppThemeOverride } from "@/renderer/theme/applyAppTheme";
import { useCoverPlaybook } from "./coverPlaybookTheme";
import { playbookThemeOverride } from "./themeSwitchPlan";
import { usePanePlaybook } from "../playbookTargets";
import { usePlaybookViewPref } from "../viewPrefs";
import "./hostileBinary.css";

function selectFocusedPaneId(state: ReturnType<typeof useAppStore.getState>) {
  return state.view.kind === "draft"
    ? `draft:${state.view.projectId}`
    : (selectFocusedThreadId(state) ?? undefined);
}

/**
 * The focused pane's stored playbook: a chat's config, or for a new-chat draft
 * the project's draft config (shared by that project's drafts). A mounted
 * draft picker's own choice wins over it, see `usePanePlaybook`.
 */
function storedPlaybook(
  state: ReturnType<typeof useAppStore.getState>,
  paneId: string | undefined,
) {
  if (!paneId) return undefined;
  const draftProjectId = parseDraftProjectId(paneId);
  if (draftProjectId !== undefined) {
    return getProjectMap(state.projects).get(draftProjectId)?.lastDraftConfig?.playbook;
  }
  return getThreadMap(state.threads).get(paneId)?.config?.playbook;
}

export function PlaybookThemeController() {
  const paneId = useAppStore(selectFocusedPaneId);
  const stored = useAppStore((state) => storedPlaybook(state, paneId));
  const pane = usePanePlaybook(paneId);
  const playbook =
    pane && paneId && parseDraftProjectId(paneId) !== undefined ? pane.playbook : stored;
  const customThemes = useSharedSettings((state) => state.customThemes);
  const themeOverrideAllowed = usePlaybookViewPref("themeOverride");
  const cover = useCoverPlaybook();
  const binding = cover ? cover.binding : threadPlaybookBinding({ playbook });
  const themeId = playbookThemeOverride(binding, themeOverrideAllowed, customThemes);

  useEffect(() => {
    setAppThemeOverride(themeId);
  }, [themeId]);

  // Leaving the shell restores the user's theme.
  useEffect(() => () => setAppThemeOverride(null), []);

  return null;
}
