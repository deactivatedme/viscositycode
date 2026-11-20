/**
 * ViscosityCode: sidebar toggle plus back/forward through recently focused
 * threads (./navHistory). Shown in the sidebar header and, while the sidebar
 * is collapsed, at the start of the top bar. Styles: ../activityBar.css.
 */
import { Button, Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { toggleSidebar, useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { navigateBack, navigateForward, useNavHistoryState } from "./navHistory";

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

export function NavControls() {
  const { t } = useLingui();
  const collapsed = useSidebarOverlayStore((state) => state.isCollapsed);
  const { canBack, canForward } = useNavHistoryState();
  return (
    <div className="vc-nav-controls poracode-overlay-header__controls">
      <NavButton label={collapsed ? t`Show sidebar` : t`Hide sidebar`} onPress={toggleSidebar}>
        <PanelLeft className="size-4" />
      </NavButton>
      <NavButton label={t`Back`} isDisabled={!canBack} onPress={navigateBack}>
        <ArrowLeft className="size-4" />
      </NavButton>
      <NavButton label={t`Forward`} isDisabled={!canForward} onPress={navigateForward}>
        <ArrowRight className="size-4" />
      </NavButton>
    </div>
  );
}
