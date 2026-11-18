/**
 * ViscosityCode Mission Control: the center panel (fork of Poracode). It
 * covers the split view like the Roundtable panel (the panes underneath are
 * inert and focus moves in) and shows the registered tabs — the built-in
 * "Agents" board first, then whatever other features add through
 * `registerMissionControlTab`. Only the selected tab renders. Escape or the
 * close button steps aside for the split view again.
 */
import { useEffect, useRef } from "react";
import { Button, Tabs, Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Radar, X } from "lucide-react";
import { panelHeaderIconButtonClass } from "@/renderer/components/layout/sidebarChrome";
import { useCoverSplitView } from "@/renderer/viscosity/roundtable/ui/coverSplitView";
import {
  closeMissionControl,
  setMissionControlTab,
  useMissionControlViewStore,
} from "../missionControlViewStore";
import { useMissionControlTabs } from "../tabs";
import "./missionControl.css";

const headerButtonClass = `${panelHeaderIconButtonClass} h-auto w-auto min-h-0 min-w-0`;

export function MissionControlPanel() {
  const { t, i18n } = useLingui();
  const tabs = useMissionControlTabs();
  const storedTabId = useMissionControlViewStore((state) => state.tabId);
  const selectedTabId = tabs.some((tab) => tab.id === storedTabId)
    ? storedTabId
    : (tabs[0]?.id ?? null);
  const panelRef = useRef<HTMLElement>(null);
  useCoverSplitView(panelRef);

  // Escape anywhere in the panel steps aside. Listening on the document runs
  // after React's handlers, so inner widgets that use Escape (a search field,
  // a menu) handle it first and mark it handled.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (!panel || !(event.target instanceof Node) || !panel.contains(event.target)) return;
      event.preventDefault();
      closeMissionControl();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label={t`Mission Control`}
      className="vc-mc outline-none"
      data-vc-mission-control=""
      data-vc-cover-panel=""
    >
      <Tabs
        className="vc-mc__tabs"
        variant="secondary"
        {...(selectedTabId ? { selectedKey: selectedTabId } : {})}
        onSelectionChange={(key) => setMissionControlTab(String(key))}
      >
        <header className="vc-mc__header">
          <Radar aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <h2 className="vc-mc__title">{t`Mission Control`}</h2>
          <Tabs.ListContainer className="min-w-0 flex-1">
            <Tabs.List aria-label={t`Mission Control sections`}>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.id} id={tab.id} className="whitespace-nowrap">
                  {i18n._(tab.label)}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className={headerButtonClass}
                aria-label={t`Close Mission Control`}
                onPress={closeMissionControl}
              >
                <X className="size-3.5" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="bottom">{t`Close Mission Control`}</Tooltip.Content>
          </Tooltip>
        </header>
        {tabs.map((tab) => {
          const TabContent = tab.component;
          return (
            <Tabs.Panel key={tab.id} id={tab.id} className="vc-mc__body">
              <TabContent />
            </Tabs.Panel>
          );
        })}
      </Tabs>
    </section>
  );
}
