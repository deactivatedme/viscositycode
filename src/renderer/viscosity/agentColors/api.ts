/**
 * ViscosityCode: per-agent accent colours (contract).
 *
 * Any element that represents one agent/provider (a pane, a tab, a Roundtable
 * seat, a Mission Control card, a bot) carries `data-vc-agent-kind="<agentKind>"`
 * and styles itself with `var(--vc-agent-accent, var(--vc-accent))`. The
 * agent-colours feature injects one stylesheet that defines
 * `--vc-agent-accent` per agent kind (profile kinds "<driver>:<id>" inherit
 * their driver's colour unless set), so other features never import it and
 * shared code never branches on provider names.
 */

export const AGENT_KIND_ATTRIBUTE = "data-vc-agent-kind";
export const AGENT_ACCENT_VAR = "--vc-agent-accent";

/** Spread onto an element: `<div {...agentKindAttribute(kind)}>`. */
export function agentKindAttribute(agentKind: string | undefined): Record<string, string> {
  return agentKind ? { [AGENT_KIND_ATTRIBUTE]: agentKind } : {};
}

/** CSS value for this agent's accent with the theme accent as fallback. */
export const AGENT_ACCENT_CSS = `var(${AGENT_ACCENT_VAR}, var(--vc-accent))`;
