/**
 * ViscosityCode built-in activity items. Each one reuses an existing surface
 * (sidebar, command palette, Settings, Mission Control tabs); nothing here
 * owns new behaviour. The sidebar nav list draws top actions as rows, bottom
 * actions under "More", and views in the header switch. Settings lives in the
 * sidebar profile row. Files, changes and the browser live in the right
 * sidebar (`../rightSidebar`).
 *
 * Order leaves gaps so features can slot items between them (Mission Control
 * at 110, Roundtable at 160).
 */
import { msg } from "@lingui/core/macro";
import { BookOpenText, Cloud, Gauge, MessagesSquare, Search } from "lucide-react";
import { isHomeProject } from "@/shared/homeScope";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { useCommandPaletteStore } from "@/renderer/commands/commandPaletteStore";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { openCloudAgents } from "@/renderer/viscosity/cloudAgents/openCloudAgents";
import {
  isSettingsSectionOffered,
  openSettingsSectionIfOffered,
} from "@/renderer/viscosity/commands/commandSupport";
import { openSubscriptions } from "@/renderer/viscosity/subscriptions/openSubscriptions";
import { getThreadMap } from "@/renderer/state/useThread";
import { ACTIVITY_HOST_VIEW, registerActivityBarItem } from "./activityBarRegistry";
import { DEFAULT_ACTIVITY_VIEW_ID } from "./activityViewPreference";

export const BUILTIN_ACTIVITY_ITEM_IDS = {
  agents: DEFAULT_ACTIVITY_VIEW_ID,
  search: "search",
  playbooks: "playbooks",
  subscriptions: "subscriptions",
  cloudAgents: "cloud-agents",
} as const;

/** Project/worktree/thread the activity bar commands act on (focused thread first). */
export function resolveActivityCommandScope(): {
  projectId: string;
  worktreePath?: string;
  threadId?: string;
} | null {
  const state = useAppStore.getState();
  const threadId = selectFocusedThreadId(state);
  const thread = threadId ? getThreadMap(state.threads).get(threadId) : undefined;
  if (thread) {
    return {
      projectId: thread.projectId,
      ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
      threadId: thread.id,
    };
  }
  const projectId =
    getCurrentProjectId() ?? state.projects.find((project) => !isHomeProject(project))?.id;
  return projectId ? { projectId } : null;
}

function openSearch(): void {
  useCommandPaletteStore.getState().open();
}

function useSearchOpen(): boolean {
  return useCommandPaletteStore((state) => state.isOpen);
}

function openPlaybooks(): void {
  openSettingsSectionIfOffered("playbooks");
}

function usePlaybooksOpen(): boolean {
  return usePanelStore(
    (state) =>
      state.settingsOpen && (state.settingsSection ?? state.activeSettingsSection) === "playbooks",
  );
}

function usePlaybooksOffered(): boolean {
  return isSettingsSectionOffered("playbooks");
}

let registered = false;

/** Idempotent: registers the built-in items once per renderer. */
export function registerBuiltinActivityItems(): void {
  if (registered) return;
  registered = true;
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.agents,
    label: msg`Chats`,
    icon: MessagesSquare,
    order: 100,
    view: ACTIVITY_HOST_VIEW,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.search,
    label: msg`Search`,
    icon: Search,
    // Before Mission Control (110), so Search is the first nav row after New.
    order: 90,
    action: openSearch,
    useIsActive: useSearchOpen,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.playbooks,
    label: msg`Playbooks`,
    icon: BookOpenText,
    order: 120,
    action: openPlaybooks,
    useIsActive: usePlaybooksOpen,
    useIsAvailable: usePlaybooksOffered,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.subscriptions,
    label: msg`Subscriptions`,
    icon: Gauge,
    order: 100,
    position: "bottom",
    action: openSubscriptions,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.cloudAgents,
    label: msg`Cloud agents`,
    icon: Cloud,
    order: 110,
    position: "bottom",
    action: openCloudAgents,
  });
}
