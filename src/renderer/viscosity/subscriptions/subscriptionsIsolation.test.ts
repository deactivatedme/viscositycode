import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { getProviderManifests } from "@/renderer/components/providers/providerManifest";

// Pretend subscriptions and "Customize…" overrides are display-only: Smart
// start, account pools, failover, usage polling, Roundtable, notifications and
// the host must never see them. Only this folder may read their storage key or
// modules.
const SRC = join(import.meta.dirname, "..", "..", "..");
const OWN_FOLDER = join("renderer", "viscosity", "subscriptions") + sep;
const PATTERNS = [
  "viscosity:subscriptions:v1",
  "subscriptionsPrefs",
  "pretendSubscriptions",
  "SUBSCRIPTIONS_PREFS_KEY",
  "useSubscriptions",
  "subscriptionOverrides",
  "SubscriptionOverride",
];

describe("pretend subscriptions isolation", () => {
  it("is read nowhere outside the Subscriptions folder", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
      const path = relative(SRC, join(entry.parentPath, entry.name));
      if (path.startsWith(OWN_FOLDER)) continue;
      const text = readFileSync(join(SRC, path), "utf8");
      for (const pattern of PATTERNS) {
        if (text.includes(pattern)) offenders.push(`${path}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("subscriptions provider isolation", () => {
  it("names no provider in this folder's shipped code", () => {
    const folder = import.meta.dirname;
    const names = getProviderManifests().flatMap((manifest) => [
      new RegExp(`["'\`]${manifest.kind}["'\`:]`),
      new RegExp(`\\b${i18n._(manifest.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
    ]);
    const offenders: string[] = [];
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      const path = join(entry.parentPath, entry.name);
      const text = readFileSync(path, "utf8");
      for (const name of names) {
        if (name.test(text)) offenders.push(`${relative(folder, path)}: ${name.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
