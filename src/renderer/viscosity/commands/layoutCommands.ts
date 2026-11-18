/**
 * ViscosityCode: palette commands that reveal the activity bar's surfaces
 * (Agents, Explorer, Source Control, Browser) in the desktop shell.
 *
 * Not duplicated here: Search (the activity bar's Search button opens this
 * very palette; `palette.open` covers its key) and the sidebar toggle
 * (upstream's `sidebar.toggle`).
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import {
  ACTIVITY_ITEM_IDS,
  isActivityViewOffered,
  isBrowserOffered,
  isSourceControlOffered,
  showActivityView,
  showBrowser,
  showSourceControl,
} from "./activityViews";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { offeredWhen, VISCOSITY_COMMAND_GROUP } from "./commandSupport";

export function layoutCommands(): AppCommand[] {
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
      id: VISCOSITY_COMMAND_IDS.showExplorer,
      title: msg`Show Explorer`,
      subtitle: msg`Project files in the sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["explorer", "files", "file tree", "sidebar", "activity bar", "view"],
      ...offeredWhen(isActivityViewOffered(ACTIVITY_ITEM_IDS.explorer)),
      run: () => showActivityView(ACTIVITY_ITEM_IDS.explorer),
    },
    {
      id: VISCOSITY_COMMAND_IDS.showSourceControl,
      title: msg`Show Source Control`,
      subtitle: msg`Review changes in the focused project`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["source control", "git", "changes", "diff", "review", "activity bar"],
      ...offeredWhen(isSourceControlOffered()),
      run: showSourceControl,
    },
    {
      id: VISCOSITY_COMMAND_IDS.showBrowser,
      title: msg`Show Browser`,
      subtitle: msg`Open the in-app browser panel`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["browser", "web", "preview", "panel", "activity bar"],
      ...offeredWhen(isBrowserOffered()),
      run: showBrowser,
    },
  ];
}
