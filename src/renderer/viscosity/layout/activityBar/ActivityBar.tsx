/**
 * ViscosityCode: sidebar state for the fork CSS. The vertical activity rail is
 * gone (the sidebar nav list in ../sidebar/ draws the registry now); only the
 * tracker below remains. Styles: ../activityBar.css (scoped to html[data-vc-shell]).
 */
import { type RefObject, useEffect } from "react";
import { selectIsOverlay, useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";

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
