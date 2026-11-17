/**
 * ViscosityCode activity bar: the slim, always-visible icon column at the far
 * left of the main window (Cursor-style). Items come from the registry; the
 * top strip stays clear of the title-bar zone (macOS traffic lights) and is a
 * window drag region. Styles: ../activityBar.css (scoped to html[data-vc-shell]).
 */
import { Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { type Ref, type RefObject, useEffect } from "react";
import { selectIsOverlay, useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import {
  type ActivityBarItem,
  type ActivityBarItemState,
  formatActivityBarBadge,
  isActivityViewItem,
  useActivityBarItems,
} from "./activityBarRegistry";
import { pressActivityItem, useActiveActivityViewId } from "./activityViewPreference";

function ActivityBarButton(props: {
  item: ActivityBarItem;
  state: ActivityBarItemState;
  viewShown: boolean;
}) {
  const { item, state, viewShown } = props;
  const { i18n, t } = useLingui();
  if (!state.available) return null;

  const isView = isActivityViewItem(item);
  const active = isView ? viewShown : state.active;
  const badge = formatActivityBarBadge(state.badge);
  const label = i18n._(item.label);
  const accessibleLabel = badge ? t`${label} (${badge})` : label;
  const Icon = item.icon;
  const preload = item.onPreload ?? undefined;

  return (
    <div className="vc-activitybar__slot" data-active={active || undefined}>
      <Tooltip delay={150}>
        <Tooltip.Trigger className="vc-activitybar__trigger">
          <button
            type="button"
            className="vc-activitybar__item"
            data-vc-activity-item={item.id}
            data-active={active || undefined}
            aria-label={accessibleLabel}
            aria-current={isView && active ? "page" : undefined}
            aria-pressed={item.toggle ? state.active : undefined}
            onClick={() => pressActivityItem(item)}
            onFocus={preload}
            onPointerEnter={preload}
          >
            <Icon className="size-4" />
            {badge === null ? null : (
              <span
                aria-hidden="true"
                className={badge === "" ? "vc-activitybar__badge--dot" : "vc-activitybar__badge"}
              >
                {badge}
              </span>
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right" className="pointer-events-none">
          {label}
        </Tooltip.Content>
      </Tooltip>
    </div>
  );
}

function ActivityBarEntry(props: { item: ActivityBarItem; viewShown: boolean }) {
  const { item, viewShown } = props;
  const StateProbe = item.StateProbe;
  return (
    <StateProbe
      render={(state) => <ActivityBarButton item={item} state={state} viewShown={viewShown} />}
    />
  );
}

export function ActivityBar({ ref }: { ref?: Ref<HTMLElement> }) {
  const { t } = useLingui();
  const items = useActivityBarItems();
  const activeViewId = useActiveActivityViewId();
  const sidebarShown = useSidebarOverlayStore((s) => !s.isCollapsed);
  const top = items.filter((item) => item.position === "top");
  const bottom = items.filter((item) => item.position === "bottom");

  function renderItem(item: ActivityBarItem) {
    return (
      <ActivityBarEntry
        key={item.key}
        item={item}
        viewShown={sidebarShown && item.id === activeViewId}
      />
    );
  }

  return (
    <nav ref={ref} aria-label={t`Activity bar`} className="vc-activitybar">
      <div aria-hidden="true" className="vc-activitybar__titlebar" />
      <div className="vc-activitybar__group">{top.map(renderItem)}</div>
      <div aria-hidden="true" className="vc-activitybar__spacer" />
      <div className="vc-activitybar__group vc-activitybar__group--bottom">
        {bottom.map(renderItem)}
      </div>
    </nav>
  );
}

/**
 * Writes sidebar state the fork CSS needs onto the shell root (activityBar.css):
 * - `data-vc-sidebar-collapsed` while the sidebar is collapsed, so the
 *   zero-width aside drops its divider (the activity bar draws its own edge);
 * - `data-vc-sidebar-overlay` while the floating (narrow-window) sidebar is
 *   mounted, sliding in or out, so a translucent bar can turn opaque and the
 *   overlay never shows through it.
 * Side effect only; renders nothing, so the shell itself does not subscribe
 * to sidebar state.
 */
export function ActivitySidebarStateTracker(props: { shellRef: RefObject<HTMLElement | null> }) {
  const { shellRef } = props;
  const isCollapsed = useSidebarOverlayStore((s) => s.isCollapsed);
  const isOverlay = useSidebarOverlayStore(selectIsOverlay);
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (isCollapsed) el.dataset.vcSidebarCollapsed = "";
    else delete el.dataset.vcSidebarCollapsed;
    return () => {
      delete el.dataset.vcSidebarCollapsed;
    };
  }, [isCollapsed, shellRef]);
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (isOverlay) el.dataset.vcSidebarOverlay = "";
    else delete el.dataset.vcSidebarOverlay;
    return () => {
      delete el.dataset.vcSidebarOverlay;
    };
  }, [isOverlay, shellRef]);
  return null;
}
