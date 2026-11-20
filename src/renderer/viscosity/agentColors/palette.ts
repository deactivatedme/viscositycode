/**
 * ViscosityCode: the per-agent colour palette.
 *
 * Every colour is a theme token, never a literal: the eight hues are upstream's
 * decorative project-icon palette (`--project-icon-*` in styles.css, tuned for
 * contrast separately on light and dark surfaces), the four in-between hues
 * mix two neighbouring tokens, and "accent" is the active theme's accent. So
 * every preset, light or dark, built-in or custom, recolours the agents and
 * keeps them readable. A theme may set `--vc-agent-hue-<name>` to tint agents
 * without touching project icons: the monochrome Viscosity base theme uses it
 * for muted tints (theme/viscosity/tokens.css); other themes leave it unset.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export const AGENT_COLOR_IDS = [
  "accent",
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "pink",
] as const;
export type AgentColorId = (typeof AGENT_COLOR_IDS)[number];

export interface AgentColor {
  readonly id: AgentColorId;
  readonly label: MessageDescriptor;
  /** CSS colour value built only from theme tokens. */
  readonly css: string;
}

const token = (name: string) => `var(--vc-agent-hue-${name}, var(--project-icon-${name}))`;
/** Halfway between two token hues, interpolated in OKLCH (shorter hue arc). */
const between = (a: string, b: string) => `color-mix(in oklch, ${token(a)}, ${token(b)})`;

/** Picker order: the theme accent, then the hue wheel from red to pink. */
export const AGENT_COLOR_PALETTE: readonly AgentColor[] = [
  { id: "accent", label: msg`Theme accent`, css: "var(--vc-accent)" },
  { id: "red", label: msg`Red`, css: token("red") },
  { id: "orange", label: msg`Orange`, css: token("orange") },
  { id: "amber", label: msg`Amber`, css: token("amber") },
  { id: "lime", label: msg`Lime`, css: between("green", "amber") },
  { id: "green", label: msg`Green`, css: token("green") },
  { id: "teal", label: msg`Teal`, css: token("teal") },
  { id: "cyan", label: msg`Cyan`, css: between("teal", "blue") },
  { id: "blue", label: msg`Blue`, css: token("blue") },
  { id: "indigo", label: msg`Indigo`, css: between("blue", "violet") },
  { id: "violet", label: msg`Violet`, css: token("violet") },
  { id: "fuchsia", label: msg`Fuchsia`, css: between("violet", "pink") },
  { id: "pink", label: msg`Pink`, css: token("pink") },
];

/**
 * Colours handed out automatically, in tiers. The first tier is the plain
 * token hues, at least ~37° apart in OKLCH, so up to six agents never get two
 * colours that look alike; the in-between mixes (each only ~20-30° from a
 * neighbour) are handed out only once every first-tier colour is taken. The
 * theme accent is left out so an agent never looks uncoloured, and red and
 * amber are left out so an agent's own colour never reads as the error or
 * needs-attention state.
 */
export const DEFAULT_AGENT_COLOR_TIERS: readonly (readonly AgentColorId[])[] = [
  ["blue", "violet", "pink", "orange", "teal", "green"],
  ["cyan", "indigo", "fuchsia", "lime"],
];

/** Every colour handed out automatically, first tier first. */
export const DEFAULT_AGENT_COLOR_POOL: readonly AgentColorId[] = DEFAULT_AGENT_COLOR_TIERS.flat();

const byId = new Map<string, AgentColor>(AGENT_COLOR_PALETTE.map((color) => [color.id, color]));

export function isAgentColorId(value: unknown): value is AgentColorId {
  return typeof value === "string" && byId.has(value);
}

export function findAgentColor(id: AgentColorId): AgentColor {
  // Every AgentColorId has a palette entry (palette.test.ts checks it).
  return byId.get(id)!;
}

/** CSS colour for a palette id. */
export function agentColorCss(id: AgentColorId): string {
  return findAgentColor(id).css;
}
