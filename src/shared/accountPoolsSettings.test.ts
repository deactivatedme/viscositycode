import { describe, expect, it } from "vitest";
import {
  isUsageProviderEnabledWithPools,
  usageCollectionDisabledProviders,
} from "./accountPoolUsage";
import {
  DEFAULT_USAGE_DISABLED_PROVIDER_IDS,
  DEFAULT_USAGE_ENABLED_PROVIDER_IDS,
  defaultSharedSettings,
  normalizeSharedSettings,
  type SharedSettings,
} from "./settings";
import { SETTINGS_ENTRY_FIELDS, settingsSubjectSchema } from "./settingsTransactions";

const POOLS = {
  codex: { enabled: true, members: ["codex", "codex:work"], switchAtPercent: 90 },
  claude: { enabled: false, members: ["claude"] },
};

describe("account pools setting", () => {
  it("defaults to no pools", () => {
    expect(defaultSharedSettings.accountPools).toEqual({});
    expect(normalizeSharedSettings({}).accountPools).toEqual({});
  });

  it("loads a settings file written before pools existed without changing other values", () => {
    const legacy = {
      themeMode: "light",
      disabledAgents: ["codex:work"],
      providerOrder: ["codex", "codex:work"],
      agentInstances: { work: { id: "work", driver: "codex", displayName: "Work" } },
    };
    const settings = normalizeSharedSettings(legacy);
    expect(settings.accountPools).toEqual({});
    expect(settings).toMatchObject(legacy);
  });

  it("round-trips saved pools through normalization", () => {
    const settings = normalizeSharedSettings({ accountPools: POOLS });
    expect(settings.accountPools).toEqual(POOLS);
    expect(normalizeSharedSettings(JSON.parse(JSON.stringify(settings))).accountPools).toEqual(
      POOLS,
    );
  });

  it("drops only the malformed pool when one saved pool is invalid", () => {
    const settings = normalizeSharedSettings({
      accountPools: {
        ...POOLS,
        gemini: { enabled: true, members: ["gemini"], switchAtPercent: 1 },
      },
    });
    expect(settings.accountPools).toEqual(POOLS);
  });

  it("admits per-pool settings transactions", () => {
    expect(SETTINGS_ENTRY_FIELDS).toContain("accountPools");
    expect(
      settingsSubjectSchema.safeParse({ kind: "entry", field: "accountPools", key: "codex" })
        .success,
    ).toBe(true);
    expect(
      settingsSubjectSchema.safeParse({ kind: "entry", field: "accountPools", key: "__proto__" })
        .success,
    ).toBe(false);
  });
});

describe("usage collection for pool members", () => {
  const defaultOff = DEFAULT_USAGE_DISABLED_PROVIDER_IDS[0]!;
  const defaultOn = DEFAULT_USAGE_ENABLED_PROVIDER_IDS[0];
  const settings = (
    accountPools: SharedSettings["accountPools"],
    disabledProviders: string[],
  ): Pick<SharedSettings, "usage" | "accountPools" | "agentInstances"> => ({
    usage: { ...defaultSharedSettings.usage, disabledProviders },
    accountPools,
    agentInstances: {
      work: { id: "work", driver: "codex", displayName: "Work" },
      team: { id: "team", driver: "claude", displayName: "Team" },
    },
  });

  it("tracks a pooled account that is off only by the built-in default", () => {
    expect(DEFAULT_USAGE_DISABLED_PROVIDER_IDS).toContain("gemini");
    const base = settings({ gemini: { enabled: true, members: ["gemini", "gemini:alt"] } }, [
      "gemini",
      "cursor",
    ]);
    const input = {
      ...base,
      agentInstances: {
        ...base.agentInstances,
        alt: { id: "alt", driver: "gemini", displayName: "Alt" },
      },
    };
    const before = structuredClone(input);
    expect(usageCollectionDisabledProviders(input)).toEqual(["cursor"]);
    expect(isUsageProviderEnabledWithPools(input, "gemini")).toBe(true);
    expect(input).toEqual(before);
    // A pool of one cannot fail over, so it forces no collection.
    const single = { ...input, accountPools: { gemini: { enabled: true, members: ["gemini"] } } };
    expect(usageCollectionDisabledProviders(single)).toEqual(["gemini", "cursor"]);
  });

  it("keeps the user's own opt-outs, disabled pools and unpooled defaults", () => {
    expect(defaultOff).toBeDefined();
    expect(
      usageCollectionDisabledProviders(
        settings(
          {
            claude: { enabled: true, members: ["claude", "claude:team"] },
            codex: { enabled: false, members: ["codex", "codex:work"] },
          },
          [defaultOn, "claude:team", "codex", "codex:work", defaultOff],
        ),
      ),
    ).toEqual([defaultOn, "claude:team", "codex", "codex:work", defaultOff]);
  });

  it("leaves the stored list as is without pools", () => {
    const input = settings(undefined, [...DEFAULT_USAGE_DISABLED_PROVIDER_IDS]);
    expect(usageCollectionDisabledProviders(input)).toEqual([
      ...DEFAULT_USAGE_DISABLED_PROVIDER_IDS,
    ]);
  });
});
