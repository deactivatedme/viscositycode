/**
 * ViscosityCode Roundtable UI: the "Ask all models…" palette command
 * (additive, AA compare). It opens the Roundtable setup dialog preselected to
 * the "compare" pattern; the dialog seats every ready provider (up to five)
 * once the engine reports them. It only opens the dialog in place and never
 * switches the view. Outside the desktop shell it is not offered.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { getCurrentProjectId, resolveActivePaneId } from "@/renderer/actions/currentProject";
import { useAppStore } from "@/renderer/state/appStore";
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { parseDraftProjectId } from "@/shared/paneId";
import { openRoundtableSetup } from "./roundtableViewStore";

export const ASK_ALL_MODELS_COMMAND_ID = "roundtable.askAll";
export const COMPARE_COMMANDS_KEY = "roundtable.compare";

/** The focused pane's project (its thread's, or a draft's), else the current project. */
function focusedProjectId(): string | undefined {
  const app = useAppStore.getState();
  if (app.view.kind === "thread") {
    const paneId = resolveActivePaneId(app.view.panes, app.focusedPaneId);
    const draftProjectId = parseDraftProjectId(paneId);
    if (draftProjectId) return draftProjectId;
    const thread = app.threads.find((candidate) => candidate.id === paneId);
    if (thread) return thread.projectId;
  }
  return getCurrentProjectId();
}

export function openAskAllModels(): void {
  const projectId = focusedProjectId();
  openRoundtableSetup({ pattern: "compare", ...(projectId ? { projectId } : {}) });
}

export function compareCommands(): AppCommand[] {
  const hidden = isViscosityShellActive() ? {} : { showInPalette: false, showInShortcuts: false };
  return [
    {
      id: ASK_ALL_MODELS_COMMAND_ID,
      title: msg`Ask all models…`,
      subtitle: msg`Every ready model answers the same task, side by side`,
      group: msg`Roundtable`,
      keywords: ["roundtable", "compare", "ask all", "models", "side by side", "second opinion"],
      when: "hasProject",
      ...hidden,
      run: openAskAllModels,
    },
  ];
}

let registered = false;

/** Idempotent: registers the command once per renderer. */
export function registerCompareCommands(): void {
  if (registered) return;
  registered = true;
  registerViscosityCommands(COMPARE_COMMANDS_KEY, compareCommands);
}
