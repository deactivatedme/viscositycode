/**
 * ViscosityCode: the fixed nav list at the top of the main sidebar in the
 * desktop shell. "+ New", then the activity registry's top action items as
 * icon + label rows (Search, Mission Control, Playbooks, …), then "More" with
 * the bottom action items and upstream's configurable sidebar shortcuts.
 * Below it, a quiet "Projects" label row carries upstream's sidebar header
 * controls (add project, list options, terminal, …). Registry views are not
 * rows: the header's view switch shows them. Styles: ../activityBar.css.
 */
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Ellipsis, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarHeaderControls } from "@/renderer/views/MainView/parts/SidebarHeaderControls";
import { useSidebarShortcuts } from "@/renderer/views/MainView/parts/Sidebar/parts/sidebarShortcuts";
import {
  type ActivityBarItem,
  formatActivityBarBadge,
  isActivityViewItem,
  useActivityBarItems,
} from "../activityBar/activityBarRegistry";
import { pressActivityItem } from "../activityBar/activityViewPreference";
import { openNewThreadTab } from "../tabs/tabActions";

function NavRow(props: { item: ActivityBarItem }) {
  const { item } = props;
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
          <button
            type="button"
            className="vc-sidebar-nav__row"
            data-vc-activity-item={item.id}
            data-active={state.active || undefined}
            aria-label={badge ? t`${label} (${badge})` : label}
            aria-pressed={item.toggle ? state.active : undefined}
            onClick={() => pressActivityItem(item)}
            onFocus={item.onPreload ?? undefined}
            onPointerEnter={item.onPreload ?? undefined}
          >
            <Icon className="vc-sidebar-nav__icon" />
            <span className="vc-sidebar-nav__label">{label}</span>
            {badge === null ? null : (
              <span aria-hidden="true" className="vc-sidebar-nav__badge">
                {badge}
              </span>
            )}
          </button>
        );
      }}
    />
  );
}

interface MoreEntry {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}

function MoreMenu(props: { items: readonly ActivityBarItem[] }) {
  const { i18n, t } = useLingui();
  const shortcuts = useSidebarShortcuts();
  // shortcut: bottom items are listed without their useIsAvailable probe (none
  // registered today needs one); probe them here when one does.
  const entries: MoreEntry[] = [
    ...props.items.map((item) => {
      const Icon = item.icon;
      return {
        key: `item:${item.id}`,
        label: i18n._(item.label),
        icon: <Icon className="size-4" />,
        onPress: () => pressActivityItem(item),
      };
    }),
    ...shortcuts.map((shortcut) => ({
      key: `shortcut:${shortcut.id}`,
      label: shortcut.label,
      icon: shortcut.icon,
      onPress: shortcut.onPress,
    })),
  ];
  if (entries.length === 0) return null;
  return (
    <Dropdown>
      <Dropdown.Trigger className="vc-sidebar-nav__row" aria-label={t`More`}>
        <Ellipsis className="vc-sidebar-nav__icon" />
        <span className="vc-sidebar-nav__label">{t`More`}</span>
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu
          aria-label={t`More`}
          className="poracode-menu min-w-48"
          onAction={(key) => entries.find((entry) => entry.key === String(key))?.onPress()}
        >
          {entries.map((entry) => (
            <Dropdown.Item key={entry.key} id={entry.key} textValue={entry.label}>
              <span className="flex size-4 shrink-0 items-center justify-center text-muted">
                {entry.icon}
              </span>
              <Label>{entry.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function SidebarNavList() {
  const { t } = useLingui();
  const actions = useActivityBarItems().filter((item) => !isActivityViewItem(item));
  return (
    <>
      <nav aria-label={t`Sidebar`} className="vc-sidebar-nav">
        <button
          type="button"
          className="vc-sidebar-nav__row vc-sidebar-nav__row--new"
          onClick={openNewThreadTab}
        >
          <Plus className="vc-sidebar-nav__icon" />
          <span className="vc-sidebar-nav__label">{t`New`}</span>
        </button>
        {actions
          .filter((item) => item.position === "top")
          .map((item) => (
            <NavRow key={item.key} item={item} />
          ))}
        <MoreMenu items={actions.filter((item) => item.position === "bottom")} />
      </nav>
      <div className="vc-sidebar-projects">
        <span className="vc-sidebar-projects__label">{t`Projects`}</span>
        <div className="vc-sidebar-projects__actions">
          <SidebarHeaderControls />
        </div>
      </div>
    </>
  );
}
