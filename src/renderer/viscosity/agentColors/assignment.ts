/**
 * ViscosityCode: which colour each agent kind gets.
 *
 * Pure and provider-agnostic: kinds are opaque strings. The only structure
 * used is the shared profile-kind contract ("<driver>:<id>" of a registered
 * profile driver), so another account of an agent inherits that agent's
 * colour unless the owner picked one for it.
 */
import type { AgentStatus } from "@/shared/contracts";
import { parseAgentProfileKind } from "@/shared/contracts/agentProfiles";
import { DEFAULT_AGENT_COLOR_TIERS, type AgentColorId } from "./palette";

export interface KnownAgentKind {
  kind: string;
  /** Installed agents claim distinct colours before the others. */
  installed: boolean;
}

export type AgentColorOverrides = Readonly<Record<string, AgentColorId>>;

/** Every detected agent (native and WSL, installed or not), for colour assignment. */
export function knownAgentKinds(
  ...statusLists: readonly (readonly Pick<AgentStatus, "kind" | "installed">[])[]
): KnownAgentKind[] {
  return statusLists.flat().map((status) => ({ kind: status.kind, installed: status.installed }));
}

/** FNV-1a (32-bit) over UTF-16 code units: stable across runs and platforms. */
export function hashAgentKind(kind: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < kind.length; index += 1) {
    hash ^= kind.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The profile driver this kind inherits from, or undefined for an agent of its own. */
export function inheritedDriver(kind: string): string | undefined {
  return parseAgentProfileKind(kind)?.driver;
}

/** The first free colour for `hash`, tier by tier, or undefined once every colour is taken. */
function claimColor(hash: number, taken: Set<AgentColorId>): AgentColorId | undefined {
  for (const tier of DEFAULT_AGENT_COLOR_TIERS) {
    const start = hash % tier.length;
    for (let step = 0; step < tier.length; step += 1) {
      const candidate = tier[(start + step) % tier.length]!;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
  }
  return undefined;
}

/** Colour a kind gets on its own, without looking at other kinds. */
export function preferredAgentColor(kind: string): AgentColorId {
  const firstTier = DEFAULT_AGENT_COLOR_TIERS[0]!;
  return firstTier[hashAgentKind(kind) % firstTier.length]!;
}

/**
 * Default colours for every agent that owns one (profile kinds borrow their
 * driver's, and a driver named only through its profiles still gets one).
 *
 * Each kind starts at a slot of the first tier picked by a hash of its own
 * name, so its colour does not depend on discovery order or on which threads
 * are open. When two kinds want the same colour, the one that sorts first
 * (installed before not installed, then by hash, then by name) keeps it and
 * the other moves to the next free one, trying the clearly distinct first
 * tier before the in-between hues (palette.ts). Installed agents therefore
 * get distinct colours as long as there are no more of them than pool
 * entries; beyond that, kinds fall back to their preferred colour and may
 * share.
 */
export function assignDefaultAgentColors(
  known: readonly KnownAgentKind[],
): Record<string, AgentColorId> {
  const installedByKind = new Map<string, boolean>();
  const note = (kind: string, installed: boolean) => {
    installedByKind.set(kind, (installedByKind.get(kind) ?? false) || installed);
  };
  for (const entry of known) {
    if (!entry.kind) continue;
    const driver = inheritedDriver(entry.kind);
    note(driver ?? entry.kind, entry.installed);
  }

  const ordered = [...installedByKind.entries()]
    .map(([kind, installed]) => ({ kind, installed, hash: hashAgentKind(kind) }))
    .toSorted(
      (a, b) =>
        Number(b.installed) - Number(a.installed) ||
        a.hash - b.hash ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
    );

  const taken = new Set<AgentColorId>();
  const result: Record<string, AgentColorId> = {};
  for (const { kind, hash } of ordered) {
    result[kind] = claimColor(hash, taken) ?? preferredAgentColor(kind);
  }
  return result;
}

/**
 * The colour shown for `kind`: the owner's pick, else (for a profile kind) its
 * driver's colour, else its default.
 */
export function resolveAgentColor(
  kind: string,
  overrides: AgentColorOverrides,
  defaults: Readonly<Record<string, AgentColorId>>,
): AgentColorId {
  if (Object.hasOwn(overrides, kind)) return overrides[kind]!;
  const driver = inheritedDriver(kind);
  if (driver) return resolveAgentColor(driver, overrides, defaults);
  return Object.hasOwn(defaults, kind) ? defaults[kind]! : preferredAgentColor(kind);
}
