/**
 * ViscosityCode: the main Sidebar's switchable views.
 *
 * Renders, over the top of upstream's sidebar column, ONE header row (the
 * sidebar toggle on the left, the view switch on the right; Back/Forward live
 * in the top bar; the active view's title stays for screen readers; AppShell drops upstream's
 * separate titlebar header row in the shell) and, for registry views, the view
 * body. The row sits at the window's top edge, so it is the window drag region
 * there and clears the macOS traffic lights. The Agents view is upstream's own column (the "host"
 * view): it stays mounted underneath and is only made invisible while another
 * view is shown, so its scroll and collapse state survive view switches. The
 * column reserves the header row through `.vc-sidebar-host-column`
 * (activityBar.css).
 */
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { macosTrafficLightGutterClass } from "@/renderer/components/layout/sidebarChrome";
import { hasMacWindowChrome } from "@/renderer/components/layout/windowChrome";
import { SIDEBAR_MIN_WIDTH } from "@/renderer/views/MainView/parts/AppShell/parts/useResizablePanels";
import {
  ACTIVITY_HOST_VIEW,
  type ActivityBarItem,
  type ActivitySidebarView,
  useActivityBarItems,
} from "./activityBarRegistry";
import { useActiveActivityViewId } from "./activityViewPreference";
import { registerBuiltinActivityItems } from "./builtinActivityItems";
import { ActivityViewSwitch } from "../sidebar/ActivityViewSwitch";
import { SidebarToggle } from "../topBar/NavControls";

registerBuiltinActivityItems();

function activeViewOf(
  items: readonly ActivityBarItem[],
  activeViewId: string,
): { item: ActivityBarItem | undefined; view: ActivitySidebarView } {
  const item = items.find((candidate) => candidate.id === activeViewId);
  return { item, view: item?.view ?? ACTIVITY_HOST_VIEW };
}

/** True while a registry view covers the host (Agents) column. */
export function useActivityHostViewHidden(activityBarActive: boolean): boolean {
  const items = useActivityBarItems();
  const activeViewId = useActiveActivityViewId();
  if (!activityBarActive) return false;
  return activeViewOf(items, activeViewId).view !== ACTIVITY_HOST_VIEW;
}

export function ActivitySidebarViews(props: {
  /** The sidebar is expanded (or floating) and the window is visible. */
  visible: boolean;
  collapsed: boolean;
}) {
  const { t, i18n } = useLingui();
  const items = useActivityBarItems();
  const activeViewId = useActiveActivityViewId();
  const { item, view } = activeViewOf(items, activeViewId);
  const RegistryView = view === ACTIVITY_HOST_VIEW ? null : view;
  const HeaderAccessory = item?.viewHeaderAccessory ?? null;
  const title = item ? i18n._(item.label) : t`Chats`;

  return (
    <div
      className={`vc-sidebar-views ${props.collapsed ? "invisible" : ""}`}
      data-vc-sidebar-view={activeViewId}
      data-vc-registry-view={RegistryView ? "" : undefined}
      data-vc-sidebar-shown={props.collapsed ? undefined : ""}
      style={{ minWidth: SIDEBAR_MIN_WIDTH }}
    >
      <div className="vc-sidebar-view-header">
        {hasMacWindowChrome() ? (
          <div aria-hidden="true" className={macosTrafficLightGutterClass} />
        ) : null}
        <h2 className="sr-only">{title}</h2>
        <SidebarToggle />
        {HeaderAccessory ? <HeaderAccessory /> : null}
        <div aria-hidden="true" className="min-w-0 flex-1" />
        <ActivityViewSwitch />
      </div>
      {RegistryView ? (
        // Keyed so a view switch remounts the body (fresh scroll and state).
        <div key={activeViewId} className="vc-sidebar-view-body">
          <Suspense fallback={null}>
            <RegistryView visible={props.visible} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
