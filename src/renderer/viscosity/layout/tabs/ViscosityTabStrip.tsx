import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { Button, Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { EditorTab } from "./EditorTab";
import { startOpenTabsSync, useRenderableTabIds } from "./openTabsStore";
import { closeThreadTab, openNewThreadTab } from "./tabActions";
import { ThreadTab } from "./ThreadTab";

const TAB_SELECTOR = '[role="tab"]';

function focusSiblingTab(event: KeyboardEvent<HTMLDivElement>): void {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TAB_SELECTOR));
  const index = tabs.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  let next = index;
  if (event.key === "ArrowRight") next = Math.min(tabs.length - 1, index + 1);
  else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else if (event.key === "Delete") {
    const threadId = tabs[index]!.dataset.vcTabId;
    if (!threadId) return;
    event.preventDefault();
    closeThreadTab(threadId);
    return;
  } else return;
  event.preventDefault();
  tabs[next]!.focus();
}

/** Thread id of the tab an event came from (its title button or its close button). */
function tabThreadIdFromEvent(event: MouseEvent<HTMLElement>): string | undefined {
  if (!(event.target instanceof Element)) return undefined;
  return event.target.closest<HTMLElement>("[data-vc-tab-thread]")?.dataset.vcTabThread;
}

/** Middle-click closes a tab, like browser and editor tabs. */
function closeTabOnMiddleClick(event: MouseEvent<HTMLDivElement>): void {
  if (event.button !== 1) return;
  const threadId = tabThreadIdFromEvent(event);
  if (!threadId) return;
  event.preventDefault();
  closeThreadTab(threadId);
}

/** Swallow the middle-button press so Chromium does not start autoscroll. */
function preventMiddleButtonAutoscroll(event: MouseEvent<HTMLDivElement>): void {
  if (event.button === 1) event.preventDefault();
}

/** Vertical wheel scrolls the overflowing strip sideways, like editor tab bars. */
function scrollSideways(event: WheelEvent<HTMLDivElement>): void {
  if (event.deltaX !== 0 || event.deltaY === 0) return;
  event.currentTarget.scrollLeft += event.deltaY;
}

/**
 * Bring a tab fully into the strip's view by scrolling only the strip itself
 * (`scrollIntoView` would also scroll the shell's overflow-hidden ancestors).
 */
function revealTab(scroller: HTMLElement, tab: HTMLElement): void {
  const bounds = scroller.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  if (rect.left < bounds.left) scroller.scrollLeft += rect.left - bounds.left;
  else if (rect.right > bounds.right) scroller.scrollLeft += rect.right - bounds.right;
}

/**
 * Cursor-style strip of open threads above the center split view. Clicking a
 * tab shows that thread in the focused pane; it never changes the pane layout
 * itself, so saved layouts stay upstream's.
 */
export function ViscosityTabStrip() {
  const { t } = useLingui();
  const tabIds = useRenderableTabIds();
  const focusedThreadId = useAppStore(selectFocusedThreadId);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => startOpenTabsSync(), []);

  useEffect(() => {
    if (!focusedThreadId || !tabIds.includes(focusedThreadId)) return;
    const scroller = scrollerRef.current;
    const tab = scroller?.querySelector<HTMLElement>(
      `[data-vc-tab-id="${CSS.escape(focusedThreadId)}"]`,
    );
    if (scroller && tab) revealTab(scroller, tab);
  }, [focusedThreadId, tabIds]);

  return (
    <div
      data-vc-tabstrip=""
      className={`vc-tabstrip poracode-content-over-drag-region--drag ${macosTrafficLightPadClass} flex h-[var(--vc-tabstrip-height)] shrink-0 items-stretch`}
    >
      <div
        role="tablist"
        aria-label={t`Open threads`}
        aria-orientation="horizontal"
        tabIndex={-1}
        className="vc-tabstrip__tabs poracode-overlay-header__controls flex min-w-0 items-stretch outline-none"
        onKeyDown={focusSiblingTab}
        onMouseDown={preventMiddleButtonAutoscroll}
        onAuxClick={closeTabOnMiddleClick}
      >
        <EditorTab />
        <div
          ref={scrollerRef}
          className="vc-tabstrip__scroller flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden"
          onWheel={scrollSideways}
        >
          {tabIds.map((threadId) => (
            <ThreadTab key={threadId} threadId={threadId} />
          ))}
        </div>
      </div>
      <div className="vc-tabstrip__actions poracode-overlay-header__controls flex shrink-0 items-center">
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={t`New thread`}
              className="vc-tabstrip__new size-6 min-w-0 shrink-0 p-0"
              onPress={openNewThreadTab}
            >
              <Plus className="size-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="bottom">{t`New thread`}</Tooltip.Content>
        </Tooltip>
      </div>
      <div aria-hidden="true" className="min-w-0 flex-1" />
    </div>
  );
}
