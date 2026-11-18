/**
 * ViscosityCode: the generated per-agent stylesheet.
 *
 * One rule per known agent kind defines `--vc-agent-accent` on every element
 * carrying `data-vc-agent-kind` (api.ts). A profile driver's rule also covers
 * its profile kinds by prefix, so another account of that agent inherits the
 * colour even before it is discovered; profile kinds the owner coloured get
 * their own rule after it (same specificity, later wins).
 */
import { AGENT_ACCENT_VAR, AGENT_KIND_ATTRIBUTE } from "./api";
import {
  assignDefaultAgentColors,
  inheritedDriver,
  resolveAgentColor,
  type AgentColorOverrides,
  type KnownAgentKind,
} from "./assignment";
import { agentColorCss } from "./palette";
import { isAgentProfileDriver } from "@/shared/contracts/agentProfiles";

/**
 * A CSS string literal for `value`. Anything outside a conservative set is
 * written as a hex escape, so quotes, backslashes, newlines and markup can
 * never end the string, the selector or the stylesheet.
 */
export function cssStringLiteral(value: string): string {
  let out = "";
  for (const char of value) {
    if (/^[A-Za-z0-9_.:@+-]$/.test(char)) {
      out += char;
    } else {
      // A trailing space ends the escape so a following hex digit is not swallowed.
      out += `\\${char.codePointAt(0)!.toString(16)} `;
    }
  }
  return `"${out}"`;
}

function exact(kind: string): string {
  return `[${AGENT_KIND_ATTRIBUTE}=${cssStringLiteral(kind)}]`;
}

function prefix(driver: string): string {
  return `[${AGENT_KIND_ATTRIBUTE}^=${cssStringLiteral(`${driver}:`)}]`;
}

function compareKinds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface AgentColorStylesheetInput {
  known: readonly KnownAgentKind[];
  overrides: AgentColorOverrides;
}

export function buildAgentColorStylesheet(input: AgentColorStylesheetInput): string {
  const defaults = assignDefaultAgentColors(input.known);
  const kinds = new Set<string>();
  for (const entry of input.known) if (entry.kind) kinds.add(entry.kind);
  for (const kind of Object.keys(input.overrides)) kinds.add(kind);

  const owners = new Set<string>(Object.keys(defaults));
  const profiles: string[] = [];
  for (const kind of kinds) {
    const driver = inheritedDriver(kind);
    if (driver) {
      owners.add(driver);
      profiles.push(kind);
    } else {
      owners.add(kind);
    }
  }

  const lines = ["/* ViscosityCode: per-agent accent colours (generated). */"];
  const rule = (selectors: string[], kind: string) => {
    const color = agentColorCss(resolveAgentColor(kind, input.overrides, defaults));
    lines.push(`${selectors.join(", ")} { ${AGENT_ACCENT_VAR}: ${color}; }`);
  };
  for (const kind of [...owners].toSorted(compareKinds)) {
    rule(isAgentProfileDriver(kind) ? [exact(kind), prefix(kind)] : [exact(kind)], kind);
  }
  for (const kind of profiles.toSorted(compareKinds)) {
    if (Object.hasOwn(input.overrides, kind)) rule([exact(kind)], kind);
  }
  return `${lines.join("\n")}\n`;
}
