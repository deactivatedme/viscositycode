/**
 * ViscosityCode: rows for Settings → Appearance → Agent colours.
 *
 * Pure, so the list the owner edits always shows the colours the generated
 * stylesheet applies: both derive defaults from the same detected agents
 * (`knownAgentKinds`) through `assignDefaultAgentColors`.
 */
import { getSettingsInstalledAgents } from "@/shared/agentStatus";
import type { AgentStatus } from "@/shared/contracts";
import {
  assignDefaultAgentColors,
  inheritedDriver,
  knownAgentKinds,
  resolveAgentColor,
  type AgentColorOverrides,
} from "./assignment";
import type { AgentColorId } from "./palette";

/** Where a row's colour comes from. */
export type AgentColorSource = "custom" | "inherited" | "automatic";

export interface AgentColorRow {
  kind: string;
  label: string;
  icon: string | undefined;
  color: AgentColorId;
  source: AgentColorSource;
  /** For an inherited colour: the label of the agent it comes from. */
  inheritedFromLabel: string | undefined;
}

/** One row per installed agent (native first, then WSL-only), in detection order. */
export function buildAgentColorRows(
  statuses: readonly AgentStatus[],
  wslStatuses: readonly AgentStatus[],
  overrides: AgentColorOverrides,
): AgentColorRow[] {
  const defaults = assignDefaultAgentColors(knownAgentKinds(statuses, wslStatuses));
  const labelByKind = new Map<string, string>();
  for (const status of [...wslStatuses, ...statuses]) labelByKind.set(status.kind, status.label);

  return getSettingsInstalledAgents(statuses, wslStatuses).map((status) => {
    const driver = inheritedDriver(status.kind);
    const custom = Object.hasOwn(overrides, status.kind);
    const source: AgentColorSource = custom ? "custom" : driver ? "inherited" : "automatic";
    return {
      kind: status.kind,
      label: status.label,
      icon: status.icon,
      color: resolveAgentColor(status.kind, overrides, defaults),
      source,
      inheritedFromLabel:
        source === "inherited" && driver ? (labelByKind.get(driver) ?? driver) : undefined,
    };
  });
}
