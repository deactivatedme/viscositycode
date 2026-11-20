import type { ReactNode } from "react";
import { useCurrentThreadIdsCount } from "@/renderer/hooks/uiSelectors";
// ViscosityCode: installs the per-agent colour stylesheet with the main layout.
import "@/renderer/viscosity/agentColors";
// ViscosityCode: registers the Playbook palette commands with the main layout.
import "@/renderer/viscosity/playbooks";
// ViscosityCode: Roundtable center panel (registers its activity/status bar items on import).
import { RoundtableCenterHost } from "@/renderer/viscosity/roundtable";
// ViscosityCode: Mission Control panel (registers its tab, activity/status bar items and command on import).
import { MissionControlHost } from "@/renderer/viscosity/missionControl";
// ViscosityCode: Mission Control's Cloud tab and the "Open Cloud agents" command (registers on import).
import "@/renderer/viscosity/cloudAgents";
// ViscosityCode: Zen mode (registers its palette command on import).
import { ZenModeHost } from "@/renderer/viscosity/zen";
// ViscosityCode: playbook theme override and switch animation (renders nothing).
import { PlaybookThemeController } from "@/renderer/viscosity/playbooks/theme/PlaybookThemeController";
import { useViscosityShellEnabled } from "./shellGate";
import { ViscosityTabStrip } from "./ViscosityTabStrip";

/**
 * Center column of the main window: the slim top bar above upstream's content
 * (split panes, file editor panel). Outside the fork's desktop shell
 * (phone/PWA layout, extension side panel, other windows) it renders the
 * content unchanged. `data-vc-single-pane` lets shell.css hide the pane title
 * the top bar already shows.
 */
export function ViscosityCenterFrame(props: { children: ReactNode }) {
  const enabled = useViscosityShellEnabled();
  const singlePane = useCurrentThreadIdsCount() === 1;
  if (!enabled) return props.children;
  return (
    <div
      data-vc-center=""
      data-vc-single-pane={singlePane || undefined}
      className="flex h-full min-h-0 flex-col"
    >
      <ViscosityTabStrip />
      <div data-vc-center-body="" className="relative min-h-0 flex-1">
        {props.children}
        {/* ViscosityCode: the open Roundtable over the split view, and its setup dialog. */}
        <RoundtableCenterHost />
        {/* ViscosityCode: Mission Control over the split view (every agent at a glance). */}
        <MissionControlHost />
        {/* ViscosityCode: Zen mode's Exit pill, top reveal band and Escape handling (portals into <body>). */}
        <ZenModeHost />
        <PlaybookThemeController />
      </div>
    </div>
  );
}
