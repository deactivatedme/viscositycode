import { afterEach, describe, expect, it } from "vitest";
import { memberAvailability } from "@/shared/accountPools";
import type { UsageSnapshot } from "@/shared/contracts";
import { getProviderManifests } from "@/renderer/components/providers/providerManifest";
import { pretendWindowId } from "./pretendSubscriptions";
import {
  applySubscriptionOverrides,
  overrideDraftSource,
  realUsageBars,
  sectionCustomizeAccount,
  seenPlanNames,
  subscriptionPlanSuggestions,
} from "./subscriptionOverrides";
import {
  buildSubscriptionProviders,
  knownAccountKinds,
  type SubscriptionAccount,
  type SubscriptionProvider,
} from "./subscriptionsModel";
import {
  MAX_SUBSCRIPTION_OVERRIDES,
  readSubscriptionsPrefs,
  resetSubscriptionOverride,
  sanitizeOverrideList,
  saveSubscriptionOverride,
  SUBSCRIPTIONS_PREFS_KEY,
  useSubscriptionsPrefsStore,
  type SubscriptionOverride,
} from "./subscriptionsPrefs";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function snapshot(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    providerId: "alpha",
    status: "ok",
    fetchedAt: NOW - 60_000,
    plan: "Basic",
    authenticatedAs: "real@example.com",
    windows: [{ id: "weekly", label: "Weekly", usedPercent: 42.4, resetsAt: NOW + 2 * HOUR }],
    ...partial,
  } as UsageSnapshot;
}

function account(agentKind: string, partial: Partial<SubscriptionAccount> = {}) {
  const snap = snapshot();
  const availability = memberAvailability(snap, NOW);
  return {
    agentKind,
    label: `${agentKind} label`,
    usageId: agentKind,
    status: undefined,
    readiness: "signed-in",
    snapshot: snap,
    usageSupported: true,
    usageTracked: true,
    hasUsageData: true,
    availability,
    percentLeft: 58,
    tone: "ok",
    pool: undefined,
    ...partial,
  } as SubscriptionAccount;
}

function provider(id: string, accounts: SubscriptionAccount[]): SubscriptionProvider {
  return { id, label: `${id} name`, accounts, supportsPool: false, pool: undefined };
}

const override: SubscriptionOverride = {
  key: "alpha",
  provider: "Fancy Cloud",
  plan: "Mega",
  account: "larp@example.com",
  bars: [{ label: "Session", usedPercent: 100, reset: "Resets soon" }],
};

afterEach(() => {
  localStorage.clear();
  useSubscriptionsPrefsStore.setState({ providerOrder: [], pretend: [], overrides: [] });
});

describe("override prefs", () => {
  it("sanitizes keys, text, bars and the count, and drops duplicates", () => {
    expect(
      sanitizeOverrideList([
        { ...override, plan: "  Mega\n", extra: "secret-token" },
        { ...override, provider: "dup" },
        { ...override, key: "vc-pretend:x" },
        { ...override, key: " padded " },
        { ...override, key: "beta", provider: "" },
        { key: "gamma", provider: "G", bars: [{ label: "W", usedPercent: 250 }, { label: "" }] },
        "junk",
      ]),
    ).toEqual([
      override,
      { key: "gamma", provider: "G", bars: [{ label: "W", usedPercent: 100 }] },
    ]);
    const many = Array.from({ length: MAX_SUBSCRIPTION_OVERRIDES + 5 }, (_, index) => ({
      ...override,
      key: `k${index}`,
    }));
    expect(sanitizeOverrideList(many)).toHaveLength(MAX_SUBSCRIPTION_OVERRIDES);
    expect(sanitizeOverrideList({ alpha: override })).toEqual([]);
  });

  it("reads prefs written before overrides existed as having none", () => {
    localStorage.setItem(
      SUBSCRIPTIONS_PREFS_KEY,
      JSON.stringify({ version: 1, providerOrder: ["alpha"], pretend: [] }),
    );
    expect(readSubscriptionsPrefs()).toEqual({
      providerOrder: ["alpha"],
      pretend: [],
      overrides: [],
    });
  });

  it("saves, replaces, prunes missing rows and resets to real", () => {
    expect(saveSubscriptionOverride(override, ["alpha", "beta"])).toBe(true);
    expect(saveSubscriptionOverride({ ...override, key: "beta" }, ["alpha", "beta"])).toBe(true);
    expect(saveSubscriptionOverride({ ...override, provider: " " }, ["alpha"])).toBe(false);
    expect(readSubscriptionsPrefs().overrides.map((saved) => saved.key)).toEqual(["alpha", "beta"]);
    // "beta" no longer exists: saving another drops it.
    expect(saveSubscriptionOverride({ ...override, plan: "Giga" }, ["alpha"])).toBe(true);
    expect(readSubscriptionsPrefs().overrides).toEqual([{ ...override, plan: "Giga" }]);

    resetSubscriptionOverride("alpha");
    expect(readSubscriptionsPrefs().overrides).toEqual([]);
  });

  it("keeps a hidden (disabled) account's override when another is saved", () => {
    const model = {
      statuses: [
        { kind: "alpha", label: "Alpha", installed: true, authState: "authenticated" },
        { kind: "beta", label: "Beta", installed: true, authState: "authenticated" },
      ] as unknown as Parameters<typeof knownAccountKinds>[0]["statuses"],
      instances: undefined,
      disabledAgents: ["beta"],
    };
    const shown = buildSubscriptionProviders({
      ...model,
      pools: {},
      snapshots: {},
      disabledUsageProviders: [],
      usageSupportedIds: new Set(["alpha", "beta"]),
      usageIdFor: (kind) => kind,
      providerLabel: (id) => id,
      accountLabel: (kind) => kind,
      providerRank: () => 0,
      now: NOW,
    });
    // "beta" is off, so the dashboard hides it, but the host still knows it.
    expect(shown.map((row) => row.id)).toEqual(["alpha"]);
    saveSubscriptionOverride({ ...override, key: "beta" }, knownAccountKinds(model));
    saveSubscriptionOverride(override, knownAccountKinds(model));
    expect(readSubscriptionsPrefs().overrides.map((saved) => saved.key)).toEqual(["beta", "alpha"]);
  });

  it("keeps the live-usage form (no bars) apart from typed empty bars", () => {
    const { bars: _bars, ...live } = override;
    expect(sanitizeOverrideList([live, { ...override, key: "beta", bars: [] }])).toEqual([
      live,
      { ...override, key: "beta", bars: [] },
    ]);
  });
});

describe("applySubscriptionOverrides", () => {
  const real = [provider("alpha", [account("alpha")]), provider("beta", [account("beta")])];

  it("draws the typed values in place of the real ones, keeping order and real data", () => {
    const [alpha, beta] = applySubscriptionOverrides(real, [override], NOW, (name) =>
      name === "Fancy Cloud" ? "fancy" : undefined,
    );
    expect(alpha).toMatchObject({ id: "alpha", label: "Fancy Cloud", styleKind: "fancy" });
    const row = alpha!.accounts[0]!;
    expect(row).toMatchObject({
      agentKind: "alpha",
      usageId: "alpha",
      label: "larp@example.com",
      readiness: "signed-in",
      styleKind: "fancy",
      resetTexts: { [pretendWindowId(0)]: "Resets soon" },
    });
    expect(row.snapshot).toMatchObject({ plan: "Mega", fetchedAt: NOW - 60_000 });
    expect(row.snapshot?.authenticatedAs).toBeUndefined();
    expect(row.snapshot?.windows).toEqual([
      { id: pretendWindowId(0), label: "Session", usedPercent: 100 },
    ]);
    expect(row.availability.kind).toBe("exhausted");
    expect(beta).toBe(real[1]);
    // The real rows underneath are untouched.
    expect(real[0]!.accounts[0]!.snapshot?.plan).toBe("Basic");
  });

  it("keeps the real look while the name is unchanged and a letter icon for free text", () => {
    const [same] = applySubscriptionOverrides(
      real,
      [{ ...override, provider: "ALPHA NAME" }],
      NOW,
      () => undefined,
    );
    expect(same!.styleKind).toBeUndefined();
    const [free] = applySubscriptionOverrides(real, [override], NOW, () => undefined);
    expect(free!.styleKind).toBe("vc-pretend:alpha");
  });

  it("ignores overrides of missing rows and leaves pretend rows alone", () => {
    const pretend = { ...provider("vc-pretend:p", [account("vc-pretend:p")]), pretendId: "p" };
    const out = applySubscriptionOverrides(
      [...real, pretend],
      [
        { ...override, key: "gone" },
        { ...override, key: "vc-pretend:p" },
      ],
      NOW,
      () => undefined,
    );
    expect(out).toEqual([...real, pretend]);
  });

  it("falls back to the provider name and hides the plan when left empty", () => {
    const { plan: _plan, account: _account, ...bare } = override;
    const [alpha] = applySubscriptionOverrides(real, [{ ...bare, bars: [] }], NOW, () => undefined);
    const row = alpha!.accounts[0]!;
    expect(row.label).toBe("Fancy Cloud");
    expect(row.snapshot?.plan).toBeUndefined();
    expect(row.hasUsageData).toBe(false);
  });

  it("keeps the real usage live when only the plan or name changes", () => {
    const limited = account("alpha", {
      snapshot: snapshot({ status: "rate-limited", rateLimitedUntil: NOW + HOUR, error: "429" }),
    });
    const [alpha] = applySubscriptionOverrides(
      [provider("alpha", [limited])],
      [{ key: "alpha", provider: "alpha name", plan: "Mega", account: "alpha label" }],
      NOW,
      () => undefined,
    );
    const row = alpha!.accounts[0]!;
    // Real windows (ids, resetsAt) stay, so the row keeps its live countdowns.
    expect(row.snapshot).toEqual({ ...limited.snapshot, plan: "Mega" });
    expect(row.resetTexts).toBeUndefined();
    expect(row.label).toBe("alpha label");
    expect(row.availability).toEqual(memberAvailability(limited.snapshot, NOW));
  });

  it("drops the real identity line only when another account name is typed", () => {
    const [renamed] = applySubscriptionOverrides(
      real,
      [{ key: "alpha", provider: "alpha name", account: "someone else" }],
      NOW,
      () => undefined,
    );
    expect(renamed!.accounts[0]!.snapshot?.authenticatedAs).toBeUndefined();
    expect(renamed!.accounts[0]!.snapshot?.windows).toEqual(
      real[0]!.accounts[0]!.snapshot?.windows,
    );
  });

  it("names a section after its first customized account", () => {
    const multi = provider("alpha", [account("alpha"), account("alpha:work")]);
    const overrides = [{ ...override, key: "alpha:work" }];
    const [section] = applySubscriptionOverrides([multi], overrides, NOW, () => undefined);
    expect(section!.label).toBe("Fancy Cloud");
    expect(section!.accounts[0]).toBe(multi.accounts[0]);
    expect(sectionCustomizeAccount(multi, overrides)?.agentKind).toBe("alpha:work");
    expect(sectionCustomizeAccount(multi, [])?.agentKind).toBe("alpha");
  });
});

describe("overrideDraftSource", () => {
  it("prefills from the real row with its usage left live", () => {
    const alpha = provider("alpha", [account("alpha")]);
    expect(overrideDraftSource(alpha.label, alpha.accounts[0]!, undefined)).toEqual({
      key: "alpha",
      provider: "alpha name",
      plan: "Basic",
      account: "alpha label",
    });
    // Typed bars start from the real windows, without a countdown that would go stale.
    expect(realUsageBars(alpha.accounts[0]!)).toEqual([{ label: "Weekly", usedPercent: 42 }]);
  });

  it("prefers the saved override", () => {
    const alpha = provider("alpha", [account("alpha")]);
    expect(overrideDraftSource(alpha.label, alpha.accounts[0]!, override)).toBe(override);
  });
});

describe("plan suggestions", () => {
  it("lists a provider's declared plan names, then seen plans, deduped", () => {
    const declaring = getProviderManifests().find(
      (manifest) => (manifest.subscriptionPlanNames?.length ?? 0) > 0,
    );
    expect(declaring).toBeDefined();
    const declared = declaring!.subscriptionPlanNames!;
    expect(
      subscriptionPlanSuggestions(declaring!.kind, [declared[0]!.toUpperCase(), "Seen Tier"]),
    ).toEqual([...declared, "Seen Tier"]);
  });

  it("works with no capability declared or a free-text provider", () => {
    const silent = getProviderManifests().find((manifest) => !manifest.subscriptionPlanNames);
    expect(silent).toBeDefined();
    expect(subscriptionPlanSuggestions(silent!.kind, ["Seen"])).toEqual(["Seen"]);
    expect(subscriptionPlanSuggestions(undefined, [])).toEqual([]);
  });

  it("collects plans from a provider's real accounts only", () => {
    const providers = [
      provider("alpha", [account("alpha"), account("alpha:work")]),
      provider("beta", [account("beta", { snapshot: snapshot({ plan: "Other" }) })]),
      { ...provider("vc-pretend:p", [account("vc-pretend:p")]), pretendId: "p" },
    ];
    expect(seenPlanNames(providers, "alpha")).toEqual(["Basic", "Basic"]);
    expect(seenPlanNames(providers, undefined)).toEqual([]);
  });
});
