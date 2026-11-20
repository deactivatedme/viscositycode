/**
 * ViscosityCode: collapsible "Pinned" section at the top of the main
 * sidebar's project list in the desktop shell. It lists starred (upstream's
 * "Pin to top"), unarchived threads from every project as plain one-line
 * rows; they also stay at the top of their own project. Hidden when none are
 * pinned. The collapsed state is a per-viewer preference in localStorage.
 * Styles: ../activityBar.css.
 */
import { useLingui } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/shallow";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useThread } from "@/renderer/state/useThread";
import { activateThreadTab } from "../tabs/tabActions";

export const PINNED_COLLAPSED_STORAGE_KEY = "viscosity:sidebar-pinned-collapsed:v1";

/** Collapsed only when the stored value is exactly "true"; missing or malformed means expanded. */
export function readPinnedCollapsed(): boolean {
  try {
    return localStorage.getItem(PINNED_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writePinnedCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PINNED_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Best-effort view preference (private mode, quota, blocked site data).
  }
}

function PinnedRow(props: { threadId: string }) {
  const thread = useThread(props.threadId);
  const active = useAppStore((state) => selectFocusedThreadId(state) === props.threadId);
  if (!thread) return null;
  return (
    <button
      type="button"
      className="vc-sidebar-pinned__row"
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
      onClick={() => activateThreadTab(props.threadId)}
    >
      <span className="vc-sidebar-pinned__title">{thread.title}</span>
    </button>
  );
}

export function SidebarPinnedSection() {
  const { t } = useLingui();
  const [collapsed, setCollapsed] = useState(readPinnedCollapsed);
  const threadIds = useAppStore(
    useShallow((state) =>
      state.threads.filter((thread) => thread.starred && !thread.archived).map(({ id }) => id),
    ),
  );
  if (threadIds.length === 0) return null;

  const toggle = () => {
    writePinnedCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  return (
    <section className="vc-sidebar-pinned" aria-label={t`Pinned`}>
      <button
        type="button"
        className="vc-sidebar-pinned__header"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span>{t`Pinned`}</span>
        <ChevronRight aria-hidden="true" className="vc-sidebar-pinned__chevron" />
      </button>
      {collapsed ? null : (
        <div className="vc-sidebar-pinned__list">
          {threadIds.map((threadId) => (
            <PinnedRow key={threadId} threadId={threadId} />
          ))}
        </div>
      )}
    </section>
  );
}
