/**
 * ViscosityCode: whether this window renders the fork's desktop shell chrome
 * (tab strip, status bar). Same condition as `html[data-vc-shell]`
 * (see `viscosity/shellFlag.ts`), but read-only: it never acquires the
 * attribute, which the main AppShell owns.
 */
import { useCompactLayout } from "@/renderer/adaptiveLayout";
import { isChatSidebarSurface } from "@/renderer/clientSurface";
import { shouldEnableViscosityShell } from "@/renderer/viscosity/shellFlag";

function readWindowKind(): string | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement.dataset.windowKind;
}

export function useViscosityShellEnabled(): boolean {
  const compactLayout = useCompactLayout();
  return shouldEnableViscosityShell({
    windowKind: readWindowKind(),
    compactLayout,
    chatSidebarSurface: isChatSidebarSurface(),
  });
}
