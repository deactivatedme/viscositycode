/**
 * ViscosityCode: the actions on the right of the main sidebar's merged header
 * row (Cursor-style). Upstream's own sidebar header controls (add project,
 * list options, terminal, update check, …) follow a Home button that stands in
 * for upstream's brand wordmark, which also led home. The activity bar already
 * provides Search and Browser, so activityBar.css hides those two controls;
 * every other upstream control keeps its behaviour, including ones upstream
 * adds later.
 */
import { Button, Tooltip } from "@heroui/react";
import { House } from "lucide-react";
import { startTransition } from "react";
import { getAppName } from "@/shared/appName";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { SidebarHeaderControls } from "@/renderer/views/MainView/parts/SidebarHeaderControls";

function goHome(): void {
  startTransition(() => useAppStore.getState().openHome());
}

export function SidebarHeaderActions() {
  // Same label upstream gives its Home buttons (collapsed rail, narrow header).
  const appName = getAppName(readBridge().channel, import.meta.env.DEV);
  return (
    <div className="vc-sidebar-view-actions poracode-overlay-header__controls">
      <Tooltip delay={150}>
        <Tooltip.Trigger>
          <Button
            isIconOnly
            aria-label={appName}
            size="sm"
            variant="ghost"
            className="size-6 min-w-0 text-muted hover:text-foreground"
            onPress={goHome}
          >
            <House className="size-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom">{appName}</Tooltip.Content>
      </Tooltip>
      <SidebarHeaderControls />
    </div>
  );
}
