// ViscosityCode: account pools persist through the shared settings write path (fork of Poracode).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedSettings } from "@/shared/settings";
import { useSharedSettings, waitForPendingSharedSettings } from "./sharedSettingsStore";

const originalPoracodeBridge = window.poracode;
const POOLS = {
  codex: { enabled: true, members: ["codex", "codex:work"], switchAtPercent: 90 },
};

describe("sharedSettingsStore account pools", () => {
  let writes: SharedSettings[];

  beforeEach(() => {
    localStorage.clear();
    writes = [];
    const setSharedSettings = vi.fn<(settings: SharedSettings) => Promise<void>>((settings) => {
      writes.push(settings);
      return Promise.resolve();
    });
    window.poracode = { setSharedSettings } as unknown as typeof window.poracode;
    useSharedSettings.setState({
      agentInstances: { work: { id: "work", driver: "codex", displayName: "Work" } },
      accountPools: {},
    });
  });

  afterEach(() => {
    if (originalPoracodeBridge) window.poracode = originalPoracodeBridge;
    else Reflect.deleteProperty(window, "poracode");
  });

  it("writes pools through the host settings write and the local cache", async () => {
    useSharedSettings.getState().setAccountPools(POOLS);
    await waitForPendingSharedSettings();
    expect(useSharedSettings.getState().accountPools).toEqual(POOLS);
    expect(writes.at(-1)?.accountPools).toEqual(POOLS);
    expect(JSON.parse(localStorage.getItem("poracode-shared-settings")!)).toMatchObject({
      accountPools: POOLS,
    });
  });

  it("persists a removed profile leaving its pool", async () => {
    useSharedSettings.setState({ accountPools: POOLS });
    useSharedSettings.getState().removeAgentInstance("work");
    await waitForPendingSharedSettings();
    expect(writes.at(-1)?.accountPools).toEqual({
      codex: { ...POOLS.codex, members: ["codex"] },
    });
  });

  it("omits the key instead of writing undefined when pools are absent", async () => {
    useSharedSettings.setState({ accountPools: undefined });
    useSharedSettings.getState().setAgentInstance({ id: "home", driver: "codex" });
    await waitForPendingSharedSettings();
    expect(writes.at(-1)).toBeDefined();
    expect(Object.hasOwn(writes.at(-1)!, "accountPools")).toBe(false);
  });
});
