/**
 * ViscosityCode: the right sidebar's open button at the far right of the tab
 * strip. It shows only while the sidebar is closed: the open panel's own
 * header carries the hide button. The open state is upstream's own panel
 * visibility, mirrored for the toggle command (see
 * `setRightSidebarOpenSnapshot`), so this stays mounted either way.
 */
import { useEffect } from "react";
import { Button, Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { PanelRight } from "lucide-react";
import { readBridge } from "@/renderer/bridge";
import { formatCommandShortcut } from "@/renderer/commands/keybindingMatcher";
import { useKeybindingStore } from "@/renderer/commands/keybindingStore";
import { usePanelVisibility } from "@/renderer/views/MainView/parts/AppShell/parts/usePanelVisibility";
import { VISCOSITY_COMMAND_IDS } from "@/renderer/viscosity/commands/commandIds";
import { useZenModeStore } from "@/renderer/viscosity/zen/zenModeStore";
import { setRightSidebarOpenSnapshot, toggleRightSidebar } from "./rightSidebarActions";

/** The bound chord, read only while the tooltip shows (rebinding updates it). */
function ShortcutHint() {
  const keybindings = useKeybindingStore((state) => state.keybindings);
  const shortcut = formatCommandShortcut(
    VISCOSITY_COMMAND_IDS.rightSidebarToggle,
    keybindings,
    readBridge().platform,
  );
  if (!shortcut) return null;
  return (
    <span className="rounded border border-[color:var(--border)] px-1.5 py-0.5 text-[11px] text-muted">
      {shortcut}
    </span>
  );
}

export function RightSidebarToggle() {
  const { t } = useLingui();
  const { sidePanelOpen } = usePanelVisibility();
  const zenActive = useZenModeStore((state) => state.active);
  // Zen hides the panel slot, so an open panel shows as closed; pressing leaves Zen.
  const open = sidePanelOpen && !zenActive;

  useEffect(() => {
    setRightSidebarOpenSnapshot(sidePanelOpen);
  }, [sidePanelOpen]);

  const label = t`Show right sidebar`;
  return (
    // The wrapper stays so the strip keeps its end inset while the button is hidden.
    <div className="vc-tabstrip__end poracode-overlay-header__controls flex shrink-0 items-center">
      {open ? null : (
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={label}
              className="vc-tabstrip__new size-6 min-w-0 shrink-0 p-0"
              onPress={toggleRightSidebar}
            >
              <PanelRight className="size-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="bottom">
            <span className="flex items-center gap-2">
              {label}
              <ShortcutHint />
            </span>
          </Tooltip.Content>
        </Tooltip>
      )}
    </div>
  );
}
