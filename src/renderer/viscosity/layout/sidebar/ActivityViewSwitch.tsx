/**
 * ViscosityCode: segmented switch over the registered sidebar views (Chats,
 * Roundtable, …) at the right of the sidebar header. Hidden while only one
 * view is registered and available. Styles: ../activityBar.css.
 */
import { Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { showActivityView } from "@/renderer/viscosity/commands/activityViews";
import {
  type ActivityBarItem,
  formatActivityBarBadge,
  isActivityViewItem,
  useActivityBarItems,
} from "../activityBar/activityBarRegistry";
import { useActiveActivityViewId } from "../activityBar/activityViewPreference";

function ViewSegment(props: { item: ActivityBarItem; active: boolean }) {
  const { item, active } = props;
  const { i18n, t } = useLingui();
  const StateProbe = item.StateProbe;
  const Icon = item.icon;
  const label = i18n._(item.label);
  return (
    <StateProbe
      render={(state) => {
        if (!state.available) return null;
        const badge = formatActivityBarBadge(state.badge);
        return (
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <button
                type="button"
                className="vc-view-switch__segment"
                data-vc-activity-item={item.id}
                data-active={active || undefined}
                aria-label={badge ? t`${label} (${badge})` : label}
                aria-pressed={active}
                onClick={() => showActivityView(item.id)}
                onFocus={item.onPreload ?? undefined}
                onPointerEnter={item.onPreload ?? undefined}
              >
                <Icon className="size-3.5" />
                {badge === null ? null : (
                  <span aria-hidden="true" className="vc-view-switch__dot" />
                )}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="bottom">{label}</Tooltip.Content>
          </Tooltip>
        );
      }}
    />
  );
}

export function ActivityViewSwitch() {
  const { t } = useLingui();
  const views = useActivityBarItems().filter(isActivityViewItem);
  const activeViewId = useActiveActivityViewId();
  if (views.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={t`Sidebar view`}
      className="vc-view-switch poracode-overlay-header__controls"
    >
      {views.map((item) => (
        <ViewSegment key={item.key} item={item} active={item.id === activeViewId} />
      ))}
    </div>
  );
}
