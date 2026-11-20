import { useEffect } from "react";
import { useLingui } from "@lingui/react/macro";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { RightSidebarToggle } from "../rightSidebar/RightSidebarToggle";
import { startNavHistory } from "../topBar/navHistory";
import { HistoryControls, SidebarToggle } from "../topBar/NavControls";
import { EditorTab } from "./EditorTab";
import { startOpenTabsSync } from "./openTabsStore";
import { RoundtableTab } from "./RoundtableTab";

/** The focused thread's title, "New session" on a draft or home, else nothing. */
function SessionTitle() {
  const { t } = useLingui();
  const title = useAppStore((state) => {
    const threadId = selectFocusedThreadId(state);
    return threadId ? (getThreadMap(state.threads).get(threadId)?.title ?? null) : null;
  });
  const fresh = useAppStore((state) => state.view.kind === "draft" || state.view.kind === "home");
  const text = title ?? (fresh ? t`New session` : null);
  return (
    <span className="vc-topbar__title" data-vc-session-title="">
      {text}
    </span>
  );
}

/**
 * Slim top bar above the center split view (desktop shell): the sidebar toggle
 * while the sidebar is collapsed, Back/Forward, the session title, then the
 * Editor and Roundtable chips and the right sidebar toggle. Threads are opened
 * from the sidebar; the open-tabs store stays as a headless helper for other
 * features.
 */
export function ViscosityTabStrip() {
  const { t } = useLingui();
  const sidebarCollapsed = useSidebarOverlayStore((state) => state.isCollapsed);

  useEffect(() => startOpenTabsSync(), []);
  useEffect(() => startNavHistory(), []);

  return (
    <div
      data-vc-tabstrip=""
      className={`vc-tabstrip poracode-content-over-drag-region--drag ${macosTrafficLightPadClass} flex h-[var(--vc-tabstrip-height)] shrink-0 items-center`}
    >
      {sidebarCollapsed ? <SidebarToggle /> : null}
      <HistoryControls />
      <SessionTitle />
      <div
        role="tablist"
        aria-label={t`Open panels`}
        aria-orientation="horizontal"
        className="vc-tabstrip__tabs poracode-overlay-header__controls flex shrink-0 items-stretch self-stretch"
      >
        <EditorTab />
        {/* ViscosityCode: pinned tab of the open Roundtable session. */}
        <RoundtableTab />
      </div>
      <RightSidebarToggle />
    </div>
  );
}
