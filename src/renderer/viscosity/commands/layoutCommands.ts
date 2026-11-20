/**
 * ViscosityCode: palette commands for the desktop shell's layout: the left
 * sidebar's Agents view, and the right sidebar (upstream's right panel) with
 * its Changes, Explorer, Notes, Usage and Browser tabs. Their default keys are
 * in `src/shared/viscosity/keybindings.ts` (rebindable in Settings → Shortcuts).
 *
 * Not duplicated here: Search (the activity bar's Search button opens this
 * very palette; `palette.open` covers its key) and the left sidebar toggle
 * (upstream's `sidebar.toggle`).
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { isHomeProjectId } from "@/shared/homeScope";
import { resolveActivityCommandScope } from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import {
  isBrowserOffered,
  showRightSidebarTab,
  toggleRightSidebar,
} from "@/renderer/viscosity/layout/rightSidebar/rightSidebarActions";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import {
  ACTIVITY_ITEM_IDS,
  isActivityViewOffered,
  isSourceControlOffered,
  showActivityView,
} from "./activityViews";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { offeredWhen, VISCOSITY_COMMAND_GROUP } from "./commandSupport";

// Changes and Explorer need a repository; a Home chat has none, and the
// right sidebar would otherwise swap in Usage. The run guard covers the keys,
// which fire even when the palette hides the command.
function hasRepoScope(): boolean {
  return isSourceControlOffered() && !isHomeProjectId(resolveActivityCommandScope()?.projectId);
}

function showRepoTab(tab: "git" | "files"): void {
  if (hasRepoScope()) showRightSidebarTab(tab);
}

export function layoutCommands(): AppCommand[] {
  const inShell = isViscosityShellActive();
  const sourceControlOffered = isSourceControlOffered();
  // A Home chat hides only the palette entry: Shortcuts still lists the keys.
  const repoOffered = hasRepoScope();
  return [
    {
      id: VISCOSITY_COMMAND_IDS.showAgents,
      title: msg`Show Agents`,
      subtitle: msg`Projects and threads in the sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["agents", "threads", "projects", "sidebar", "activity bar", "view"],
      ...offeredWhen(isActivityViewOffered(ACTIVITY_ITEM_IDS.agents)),
      run: () => showActivityView(ACTIVITY_ITEM_IDS.agents),
    },
    {
      id: VISCOSITY_COMMAND_IDS.rightSidebarToggle,
      title: msg`Toggle right sidebar`,
      subtitle: msg`Show or hide Changes, Explorer, Notes and other tools`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["right sidebar", "secondary sidebar", "panel", "changes", "explorer"],
      ...offeredWhen(inShell),
      run: toggleRightSidebar,
    },
    {
      id: VISCOSITY_COMMAND_IDS.showSourceControl,
      title: msg`Show Changes`,
      subtitle: msg`Review changes in the right sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["source control", "git", "changes", "diff", "review", "right sidebar"],
      ...offeredWhen(sourceControlOffered),
      ...(repoOffered ? {} : { showInPalette: false }),
      run: () => showRepoTab("git"),
    },
    {
      id: VISCOSITY_COMMAND_IDS.showExplorer,
      title: msg`Show Explorer`,
      subtitle: msg`Project files in the right sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["explorer", "files", "file tree", "right sidebar", "view"],
      ...offeredWhen(sourceControlOffered),
      ...(repoOffered ? {} : { showInPalette: false }),
      run: () => showRepoTab("files"),
    },
    {
      id: VISCOSITY_COMMAND_IDS.showNotes,
      title: msg`Show Notes`,
      subtitle: msg`Project notes in the right sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["notes", "scratchpad", "right sidebar"],
      ...offeredWhen(inShell),
      run: () => showRightSidebarTab("notes"),
    },
    {
      id: VISCOSITY_COMMAND_IDS.showUsage,
      title: msg`Show Usage`,
      subtitle: msg`Subscription usage in the right sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["usage", "limits", "quota", "right sidebar"],
      ...offeredWhen(inShell),
      run: () => showRightSidebarTab("usage"),
    },
    {
      id: VISCOSITY_COMMAND_IDS.showBrowser,
      title: msg`Show Browser`,
      subtitle: msg`Open the in-app browser in the right sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["browser", "web", "preview", "panel", "right sidebar"],
      ...offeredWhen(isBrowserOffered()),
      run: () => showRightSidebarTab("browser"),
    },
  ];
}
