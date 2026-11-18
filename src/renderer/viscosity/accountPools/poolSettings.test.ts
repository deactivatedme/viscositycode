import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPools } from "@/shared/accountPools";
import type { AgentInstanceConfigMap } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  readAccountPools,
  useAccountPoolMemberAppender,
  useAccountPools,
  useCanWriteAccountPools,
  writeAccountPool,
} from "./poolSettings";
import { selectCollectedUsageDisabledProviders } from "./usageTracking";

const bridgeEnv = vi.hoisted(() => ({ remote: false }));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  isRemoteSession: () => bridgeEnv.remote,
}));

function appendAccountPoolMember(driver: string, agentKind: string) {
  renderHook(() => useAccountPoolMemberAppender()).result.current(driver, agentKind);
}

const instances = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
  new: { id: "new", driver: "codex", displayName: "New", config: {} },
} as AgentInstanceConfigMap;

const original = useSharedSettings.getState();

/** Stand-in for the store's `setAccountPools` (the shared settings authority's setter). */
function installSetter() {
  const setAccountPools = vi.fn<(pools: AccountPools) => void>((pools) => {
    useSharedSettings.setState({ accountPools: pools });
  });
  useSharedSettings.setState({ setAccountPools } as never);
  return setAccountPools;
}

beforeEach(() => {
  useSharedSettings.setState({ agentInstances: instances, accountPools: {} });
});

afterEach(() => {
  bridgeEnv.remote = false;
  useSharedSettings.setState(original, true);
});

describe("account pool settings", () => {
  it("reads pools leniently, dropping only the malformed entry", () => {
    useSharedSettings.setState({
      accountPools: {
        codex: { enabled: true, members: ["codex", "codex:work"] },
        claude: { enabled: "yes" } as never,
      },
    });
    expect(readAccountPools()).toEqual({
      codex: { enabled: true, members: ["codex", "codex:work"] },
    });
  });

  it("writes through the store setter with normalized members and other pools kept", () => {
    const setAccountPools = installSetter();
    useSharedSettings.setState({
      accountPools: { claude: { enabled: false, members: ["claude"] } },
    });
    expect(
      writeAccountPool("codex", {
        enabled: true,
        members: ["codex:work", "codex", "codex:work", "codex:removed", "claude"],
      }),
    ).toBe(true);
    expect(setAccountPools).toHaveBeenCalledTimes(1);
    expect(readAccountPools()).toEqual({
      claude: { enabled: false, members: ["claude"] },
      codex: { enabled: true, members: ["codex:work", "codex"] },
    });
  });

  // ViscosityCode: accounts left out of a pool are stored with it.
  it("keeps only listed accounts in a written exclusion list", () => {
    installSetter();
    writeAccountPool("codex", {
      enabled: true,
      members: ["codex", "codex:work", "codex:removed"],
      excludedMembers: ["codex:work", "codex:removed", "claude"],
    });
    expect(readAccountPools().codex).toEqual({
      enabled: true,
      members: ["codex", "codex:work"],
      excludedMembers: ["codex:work"],
    });
    writeAccountPool("codex", {
      enabled: true,
      members: ["codex", "codex:work"],
      excludedMembers: ["codex:removed"],
    });
    expect(readAccountPools().codex).toEqual({ enabled: true, members: ["codex", "codex:work"] });
  });

  it("shows the stored usage opt-outs in a remote-session client", () => {
    useSharedSettings.setState({
      usage: { ...original.usage, disabledProviders: ["gemini"] },
      accountPools: { gemini: { enabled: true, members: ["gemini"] } },
    });
    bridgeEnv.remote = true;
    const state = useSharedSettings.getState();
    expect(selectCollectedUsageDisabledProviders(state)).toBe(state.usage.disabledProviders);
  });

  it("refuses to write when the store cannot persist pools", () => {
    useSharedSettings.setState({ setAccountPools: undefined } as never);
    expect(renderHook(() => useCanWriteAccountPools()).result.current).toBe(false);
    expect(writeAccountPool("codex", { enabled: true, members: ["codex"] })).toBe(false);
    appendAccountPoolMember("codex", "codex:new");
    expect(readAccountPools()).toEqual({});
    installSetter();
    expect(renderHook(() => useCanWriteAccountPools()).result.current).toBe(true);
  });

  it("appends a newly added account to an existing pool only", () => {
    const setAccountPools = installSetter();
    appendAccountPoolMember("codex", "codex:new");
    expect(setAccountPools).not.toHaveBeenCalled();

    useSharedSettings.setState({
      accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
    });
    appendAccountPoolMember("codex", "codex:new");
    appendAccountPoolMember("codex", "codex:new");
    expect(setAccountPools).toHaveBeenCalledTimes(1);
    expect(readAccountPools().codex?.members).toEqual(["codex", "codex:work", "codex:new"]);
  });

  it("shows and writes no pools in a remote-session client, whose copy is not the host's", () => {
    const setAccountPools = installSetter();
    useSharedSettings.setState({
      accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
    });
    bridgeEnv.remote = true;
    expect(readAccountPools()).toEqual({});
    expect(renderHook(() => useAccountPools()).result.current).toEqual({});
    expect(renderHook(() => useCanWriteAccountPools()).result.current).toBe(false);
    expect(writeAccountPool("codex", { enabled: false, members: ["codex"] })).toBe(false);
    appendAccountPoolMember("codex", "codex:new");
    expect(setAccountPools).not.toHaveBeenCalled();
  });
});
