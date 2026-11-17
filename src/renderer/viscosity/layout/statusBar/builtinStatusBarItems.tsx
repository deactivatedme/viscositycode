/**
 * ViscosityCode built-in status bar items. Each reads existing store state
 * through primitive selectors and reuses existing actions; none is specific to
 * one provider. Orders leave gaps so later fork steps can slot items between.
 */
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { Button, Tooltip } from "@heroui/react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Activity, CircleAlert, CircleX, FolderGit2, GitBranch, Moon, Sun } from "lucide-react";
import { resolveThemeMode } from "@/shared/themeMode";
import { openGitReview } from "@/renderer/actions/panelActions";
import { readBridge } from "@/renderer/bridge";
import { resolveModelLabel } from "@/renderer/components/providers/modelDisplay";
import { selectFocusedThreadId, useProjectAgentStatuses } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getProjectMap } from "@/renderer/state/useThread";
import { activateThreadTab } from "../tabs/tabActions";
import {
  getAgentStateCounts,
  nextThreadToOpen,
  selectErrorCount,
  selectWaitingCount,
  selectWorkingCount,
} from "./agentCounts";
import {
  selectFocusedAgentKind,
  selectFocusedModel,
  selectFocusedProjectId,
  selectFocusedRealThreadId,
  selectFocusedWorktreeBranch,
  selectFocusedWorktreePath,
} from "./focusedThreadSelectors";
import { registerStatusBarItem } from "./statusBarRegistry";

export const BUILTIN_STATUS_BAR_ITEM_IDS = {
  branch: "branch",
  working: "agents.working",
  waiting: "agents.waiting",
  errors: "agents.errors",
  agentModel: "agent-model",
  theme: "theme",
  version: "version",
} as const;

const ITEM_CLASS = "vc-statusbar__item h-full min-w-0 shrink-0 gap-1 rounded-none px-2 font-normal";

function StatusBarTooltip(props: { label: string; children: ReactNode }) {
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>{props.children}</Tooltip.Trigger>
      <Tooltip.Content placement="top">{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

function BranchStatusItem() {
  const { t } = useLingui();
  const projectId = useAppStore(selectFocusedProjectId);
  const worktreePath = useAppStore(selectFocusedWorktreePath);
  const worktreeBranch = useAppStore(selectFocusedWorktreeBranch);
  const threadId = useAppStore(selectFocusedRealThreadId);
  const statusBranch = useGitStore((state) =>
    worktreePath
      ? state.worktreeStatuses[worktreePath]?.branch
      : projectId
        ? state.statuses[projectId]?.branch
        : undefined,
  );
  const branch = statusBranch || worktreeBranch;
  if (!projectId || !branch) return null;

  const label = worktreePath ? t`Branch ${branch} (worktree ${worktreePath})` : t`Branch ${branch}`;
  return (
    <StatusBarTooltip label={label}>
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.branch}
        className={ITEM_CLASS}
        onPress={() => openGitReview(projectId, worktreePath, threadId ?? undefined)}
      >
        {worktreePath ? (
          <FolderGit2 aria-hidden="true" className="size-3 shrink-0" />
        ) : (
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
        )}
        <span className="truncate">{branch}</span>
      </Button>
    </StatusBarTooltip>
  );
}

function WorkingStatusItem() {
  const { t } = useLingui();
  const working = useAppStore(selectWorkingCount);
  if (working === 0) return null;
  const label = t`${plural(working, { one: "# agent working", other: "# agents working" })}`;
  return (
    <span
      title={label}
      data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.working}
      data-tone="working"
      className={`${ITEM_CLASS} inline-flex items-center`}
    >
      <Activity aria-hidden="true" className="size-3 shrink-0" />
      <span aria-hidden="true" className="tabular-nums">
        {working}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function openNext(kind: "waiting" | "errors"): void {
  const state = useAppStore.getState();
  const counts = getAgentStateCounts(state.threads);
  const ids = kind === "waiting" ? counts.waitingIds : counts.errorIds;
  const threadId = nextThreadToOpen(ids, selectFocusedThreadId(state));
  if (threadId) activateThreadTab(threadId);
}

function WaitingStatusItem() {
  const { t } = useLingui();
  const waiting = useAppStore(selectWaitingCount);
  if (waiting === 0) return null;
  const label = t`${plural(waiting, {
    one: "# agent waiting for you",
    other: "# agents waiting for you",
  })}`;
  return (
    <StatusBarTooltip label={label}>
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.waiting}
        data-tone="attention"
        className={ITEM_CLASS}
        onPress={() => openNext("waiting")}
      >
        <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
        <span className="tabular-nums">{waiting}</span>
      </Button>
    </StatusBarTooltip>
  );
}

function ErrorsStatusItem() {
  const { t } = useLingui();
  const errors = useAppStore(selectErrorCount);
  if (errors === 0) return null;
  const label = t`${plural(errors, { one: "# agent stopped with an error", other: "# agents stopped with an error" })}`;
  return (
    <StatusBarTooltip label={label}>
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.errors}
        data-tone="error"
        className={ITEM_CLASS}
        onPress={() => openNext("errors")}
      >
        <CircleX aria-hidden="true" className="size-3 shrink-0" />
        <span className="tabular-nums">{errors}</span>
      </Button>
    </StatusBarTooltip>
  );
}

function AgentModelStatusItem() {
  const projectId = useAppStore(selectFocusedProjectId);
  const agentKind = useAppStore(selectFocusedAgentKind);
  const model = useAppStore(selectFocusedModel);
  const location = useAppStore((state) =>
    projectId ? getProjectMap(state.projects).get(projectId)?.location : undefined,
  );
  const agents = useProjectAgentStatuses(location);
  if (!agentKind) return null;
  const agent = agents.find((candidate) => candidate.kind === agentKind);
  const label = [agent?.label ?? agentKind, resolveModelLabel(agent, model)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return (
    <span
      title={label}
      data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.agentModel}
      className={`${ITEM_CLASS} inline-flex max-w-[40ch] items-center`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function subscribeColorScheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function ThemeToggleStatusItem() {
  const { t } = useLingui();
  const themeMode = useSharedSettings((state) => state.themeMode);
  const prefersDark = useSyncExternalStore(subscribeColorScheme, systemPrefersDark, () => true);
  const appearance = resolveThemeMode(themeMode, prefersDark);
  const label = appearance === "dark" ? t`Switch to light theme` : t`Switch to dark theme`;
  return (
    <StatusBarTooltip label={label}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.theme}
        className={ITEM_CLASS}
        onPress={() =>
          useSharedSettings.getState().setThemeMode(appearance === "dark" ? "light" : "dark")
        }
      >
        {appearance === "dark" ? (
          <Sun aria-hidden="true" className="size-3" />
        ) : (
          <Moon aria-hidden="true" className="size-3" />
        )}
      </Button>
    </StatusBarTooltip>
  );
}

function VersionStatusItem() {
  const { t } = useLingui();
  const version = readBridge().appVersion;
  // Browser clients report "remote" instead of a release version.
  if (!version || version === "remote") return null;
  const label = t`About this version`;
  return (
    <StatusBarTooltip label={label}>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t`Version ${version}`}
        data-vc-status-item={BUILTIN_STATUS_BAR_ITEM_IDS.version}
        className={ITEM_CLASS}
        onPress={() => usePanelStore.getState().openSettingsSection("about")}
      >
        <span className="tabular-nums">{t`v${version}`}</span>
      </Button>
    </StatusBarTooltip>
  );
}

let registered = false;

/** Idempotent: registers the built-in items once per renderer. */
export function registerBuiltinStatusBarItems(): void {
  if (registered) return;
  registered = true;
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.branch,
    align: "left",
    order: 100,
    component: BranchStatusItem,
  });
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.working,
    align: "left",
    order: 200,
    component: WorkingStatusItem,
  });
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.waiting,
    align: "left",
    order: 210,
    component: WaitingStatusItem,
  });
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.errors,
    align: "left",
    order: 220,
    component: ErrorsStatusItem,
  });
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.agentModel,
    align: "right",
    order: 100,
    component: AgentModelStatusItem,
  });
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.theme,
    align: "right",
    order: 800,
    component: ThemeToggleStatusItem,
  });
  registerStatusBarItem({
    id: BUILTIN_STATUS_BAR_ITEM_IDS.version,
    align: "right",
    order: 900,
    component: VersionStatusItem,
  });
}
