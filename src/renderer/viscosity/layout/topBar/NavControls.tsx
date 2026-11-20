/**
 * ViscosityCode: the sidebar toggle, and back/forward through recently focused
 * threads (./navHistory). The toggle sits at the far top-left: in the sidebar
 * header while the sidebar is open, at the start of the top bar while it is
 * collapsed (the same spot, so it does not jump). Back/Forward always sit in
 * the top bar, right before the session title. Styles: ../activityBar.css.
 */
import { Button, Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { toggleSidebar, useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { navigateBack, navigateForward, useNavHistoryState } from "./navHistory";

const GROUP_CLASS = "vc-nav-controls poracode-overlay-header__controls";

function NavButton(props: {
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={props.label}
          isDisabled={props.isDisabled === true}
          className="vc-nav-controls__button"
          onPress={props.onPress}
        >
          {props.children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom">{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Sidebar header, and the start of the top bar while the sidebar is collapsed. */
export function SidebarToggle() {
  const { t } = useLingui();
  const collapsed = useSidebarOverlayStore((state) => state.isCollapsed);
  return (
    <div className={GROUP_CLASS}>
      <NavButton label={collapsed ? t`Show sidebar` : t`Hide sidebar`} onPress={toggleSidebar}>
        <PanelLeft className="size-4" />
      </NavButton>
    </div>
  );
}

/** Back/Forward, in the top bar before the session title. */
export function HistoryControls() {
  const { t } = useLingui();
  const { canBack, canForward } = useNavHistoryState();
  return (
    <div className={GROUP_CLASS}>
      <NavButton label={t`Back`} isDisabled={!canBack} onPress={navigateBack}>
        <ArrowLeft className="size-4" />
      </NavButton>
      <NavButton label={t`Forward`} isDisabled={!canForward} onPress={navigateForward}>
        <ArrowRight className="size-4" />
      </NavButton>
    </div>
  );
}
