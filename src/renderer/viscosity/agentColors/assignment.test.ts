// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AGENT_PROFILE_DRIVERS } from "@/shared/contracts/agentProfiles";
import {
  assignDefaultAgentColors,
  hashAgentKind,
  inheritedDriver,
  knownAgentKinds,
  preferredAgentColor,
  resolveAgentColor,
  type KnownAgentKind,
} from "./assignment";
import { DEFAULT_AGENT_COLOR_POOL, DEFAULT_AGENT_COLOR_TIERS } from "./palette";

/** A registered profile driver, so profile kinds are real ones without naming a provider here. */
const DRIVER = AGENT_PROFILE_DRIVERS[0]!.driver;
const PROFILE = `${DRIVER}:work`;

const installed = (...kinds: string[]): KnownAgentKind[] =>
  kinds.map((kind) => ({ kind, installed: true }));

describe("hashAgentKind", () => {
  it("is a stable unsigned 32-bit FNV-1a hash", () => {
    // Reference values: FNV-1a 32-bit of "" and "a".
    expect(hashAgentKind("")).toBe(0x811c9dc5);
    expect(hashAgentKind("a")).toBe(0xe40c292c);
    expect(hashAgentKind("agent-a")).toBe(hashAgentKind("agent-a"));
    expect(hashAgentKind("agent-a")).toBeGreaterThanOrEqual(0);
  });
});

describe("assignDefaultAgentColors", () => {
  it("is deterministic and independent of discovery order", () => {
    const kinds = installed("agent-a", "agent-b", "agent-c", "agent-d", "agent-e");
    const first = assignDefaultAgentColors(kinds);
    expect(assignDefaultAgentColors(kinds.toReversed())).toEqual(first);
    expect(assignDefaultAgentColors([...kinds])).toEqual(first);
  });

  it("gives installed agents distinct colours while the pool lasts", () => {
    const kinds = installed(
      ...Array.from({ length: DEFAULT_AGENT_COLOR_POOL.length }, (_, index) => `agent-${index}`),
    );
    const colors = Object.values(assignDefaultAgentColors(kinds));
    expect(colors).toHaveLength(DEFAULT_AGENT_COLOR_POOL.length);
    expect(new Set(colors).size).toBe(DEFAULT_AGENT_COLOR_POOL.length);
  });

  it("keeps a lone agent on its own preferred colour", () => {
    expect(assignDefaultAgentColors(installed("agent-a"))).toEqual({
      "agent-a": preferredAgentColor("agent-a"),
    });
  });

  it("keeps up to six agents on the clearly distinct first-tier hues", () => {
    const firstTier = DEFAULT_AGENT_COLOR_TIERS[0]!;
    const kinds = installed(...Array.from({ length: firstTier.length }, (_, i) => `agent-${i}`));
    expect(new Set(Object.values(assignDefaultAgentColors(kinds)))).toEqual(new Set(firstTier));
  });

  it("hands out the in-between hues only once the first tier is taken", () => {
    const [firstTier, secondTier] = DEFAULT_AGENT_COLOR_TIERS;
    const kinds = installed(
      ...Array.from({ length: firstTier!.length + 1 }, (_, index) => `agent-${index}`),
    );
    const colors = Object.values(assignDefaultAgentColors(kinds));
    expect(colors.filter((color) => firstTier!.includes(color))).toHaveLength(firstTier!.length);
    expect(colors.filter((color) => secondTier!.includes(color))).toHaveLength(1);
  });

  it("lets installed agents claim colours before ones that are not installed", () => {
    // Find two kinds that want the same first-tier colour.
    const kinds = Array.from({ length: 64 }, (_, index) => `agent-${index}`);
    const a = kinds[0]!;
    const b = kinds.find(
      (kind) => kind !== a && preferredAgentColor(kind) === preferredAgentColor(a),
    )!;
    expect(b).toBeDefined();

    const aInstalled = assignDefaultAgentColors([
      { kind: a, installed: true },
      { kind: b, installed: false },
    ]);
    expect(aInstalled[a]).toBe(preferredAgentColor(a));
    expect(aInstalled[b]).not.toBe(aInstalled[a]);

    const bInstalled = assignDefaultAgentColors([
      { kind: a, installed: false },
      { kind: b, installed: true },
    ]);
    expect(bInstalled[b]).toBe(preferredAgentColor(b));
    expect(bInstalled[a]).not.toBe(bInstalled[b]);
  });

  it("assigns profile kinds to their driver, which owns one colour", () => {
    const colors = assignDefaultAgentColors(installed(PROFILE, `${DRIVER}:home`));
    expect(Object.keys(colors)).toEqual([DRIVER]);
  });

  it("falls back to sharing once there are more agents than colours", () => {
    const kinds = installed(
      ...Array.from(
        { length: DEFAULT_AGENT_COLOR_POOL.length + 3 },
        (_, index) => `agent-${index}`,
      ),
    );
    const colors = assignDefaultAgentColors(kinds);
    expect(Object.keys(colors)).toHaveLength(kinds.length);
    expect(new Set(Object.values(colors)).size).toBe(DEFAULT_AGENT_COLOR_POOL.length);
  });

  it("ignores empty kinds", () => {
    expect(assignDefaultAgentColors(installed(""))).toEqual({});
  });
});

describe("resolveAgentColor", () => {
  const defaults = assignDefaultAgentColors(installed(DRIVER, PROFILE, "agent-a"));

  it("uses the default, or the preferred colour for an unknown kind", () => {
    expect(resolveAgentColor("agent-a", {}, defaults)).toBe(defaults["agent-a"]);
    expect(resolveAgentColor("agent-unknown", {}, defaults)).toBe(
      preferredAgentColor("agent-unknown"),
    );
  });

  it("lets a profile kind inherit its driver's colour, including the owner's pick", () => {
    expect(inheritedDriver(PROFILE)).toBe(DRIVER);
    expect(resolveAgentColor(PROFILE, {}, defaults)).toBe(defaults[DRIVER]);
    expect(resolveAgentColor(PROFILE, { [DRIVER]: "pink" }, defaults)).toBe("pink");
  });

  it("prefers the owner's pick for the profile itself", () => {
    expect(resolveAgentColor(PROFILE, { [DRIVER]: "pink", [PROFILE]: "lime" }, defaults)).toBe(
      "lime",
    );
    expect(resolveAgentColor(DRIVER, { [PROFILE]: "lime" }, defaults)).toBe(defaults[DRIVER]);
  });

  it("does not treat other colon kinds as profiles", () => {
    expect(inheritedDriver("not-a-driver:instance")).toBeUndefined();
    expect(inheritedDriver(`${DRIVER}:`)).toBeUndefined();
    expect(inheritedDriver(DRIVER)).toBeUndefined();
  });
});

describe("knownAgentKinds", () => {
  it("flattens status lists into kinds with their install state", () => {
    expect(
      knownAgentKinds(
        [{ kind: "agent-a", installed: true }],
        [{ kind: "agent-b", installed: false }],
      ),
    ).toEqual([
      { kind: "agent-a", installed: true },
      { kind: "agent-b", installed: false },
    ]);
  });
});
