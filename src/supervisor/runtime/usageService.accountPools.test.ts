// ViscosityCode: account pools need every member's usage (fork of Poracode).
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@poracode/agents-usage";
import { DEFAULT_USAGE_DISABLED_PROVIDER_IDS } from "@/shared/settings";
import { UsageService } from "./usageService";

const NOW = 1_700_000_000_000;
const paths: string[] = [];

function tempPath(): string {
  const path = join(tmpdir(), `viscosity-pool-usage-${process.pid}-${paths.length}.json`);
  paths.push(path);
  return path;
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

function serviceFor(settings: Record<string, unknown>, ids: readonly string[]) {
  const settingsPath = tempPath();
  writeFileSync(settingsPath, JSON.stringify(settings));
  return new UsageService({
    emit: () => {},
    cachePath: tempPath(),
    settingsPath,
    host: {
      now: () => NOW,
      credentials: {
        getOAuthToken: () => Promise.resolve(undefined),
        getSecret: () => Promise.resolve(undefined),
      },
      http: { request: () => Promise.resolve({ status: 200, headers: {}, body: "{}" }) },
    },
    providerIds: [...ids],
    localCollectors: ids.map((id) => ({
      id,
      collect: (at: number): Promise<UsageSnapshot> =>
        Promise.resolve({ providerId: id, status: "ok", windows: [], fetchedAt: at }),
    })),
  });
}

describe("usage collection for account pools", () => {
  it("collects a pooled account that is off only by the fresh-install default", async () => {
    expect(DEFAULT_USAGE_DISABLED_PROVIDER_IDS).toContain("gemini");
    const usage = {
      autoRefresh: true,
      disabledProviders: [...DEFAULT_USAGE_DISABLED_PROVIDER_IDS],
    };
    const agentInstances = { work: { id: "work", driver: "gemini", displayName: "Work" } };
    const pooled = serviceFor(
      {
        usage,
        agentInstances,
        accountPools: { gemini: { enabled: true, members: ["gemini", "gemini:work"] } },
      },
      ["gemini", "gemini:work"],
    );
    expect((await pooled.refreshDueProviders()).sort()).toEqual(["gemini", "gemini:work"]);

    // A disabled pool changes nothing: the default opt-out applies again.
    const disabledPool = serviceFor(
      {
        usage,
        agentInstances,
        accountPools: { gemini: { enabled: false, members: ["gemini", "gemini:work"] } },
      },
      ["gemini", "gemini:work"],
    );
    expect(await disabledPool.refreshDueProviders()).toEqual(["gemini:work"]);
  });

  it("keeps an opt-out the default would not have made", async () => {
    const service = serviceFor(
      {
        usage: { autoRefresh: true, disabledProviders: ["claude", "claude:work"] },
        agentInstances: { work: { id: "work", driver: "claude", displayName: "Work" } },
        accountPools: { claude: { enabled: true, members: ["claude", "claude:work"] } },
      },
      ["claude", "claude:work"],
    );
    expect(await service.refreshDueProviders()).toEqual([]);
  });
});
