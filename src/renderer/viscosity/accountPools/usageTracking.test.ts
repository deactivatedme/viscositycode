// ViscosityCode: usage settings, panel and rail show pooled default-off accounts
// as tracked, the way the supervisor collects them.
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDisplayedProviders } from "@/renderer/components/providers/usageProviders";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { DEFAULT_USAGE_DISABLED_PROVIDER_IDS } from "@/shared/settings";
import {
  selectCollectedUsageDisabledProviders,
  useUsageTrackingRequiredByPool,
} from "./usageTracking";

const original = useSharedSettings.getState();

afterEach(() => {
  useSharedSettings.setState(original, true);
});

const instances = { team: { id: "team", driver: "gemini", displayName: "Team" } };

function configure(accountPools: object | undefined, disabledProviders: string[]) {
  useSharedSettings.setState({
    usage: { ...original.usage, disabledProviders },
    accountPools,
    agentInstances: instances,
  } as never);
}

describe("usage tracking with account pools", () => {
  it("tracks a pooled account that is off only by the built-in default", () => {
    expect(DEFAULT_USAGE_DISABLED_PROVIDER_IDS).toContain("gemini");
    configure({ gemini: { enabled: true, members: ["gemini", "gemini:team"] } }, [
      "gemini",
      "cursor",
    ]);
    const collected = selectCollectedUsageDisabledProviders(useSharedSettings.getState());
    expect(collected).toEqual(["cursor"]);
    // Reference-stable between calls, so it is safe as a store selector.
    expect(selectCollectedUsageDisabledProviders(useSharedSettings.getState())).toBe(collected);
    expect(
      resolveDisplayedProviders([], collected, instances).some(
        (provider) => provider.id === "gemini",
      ),
    ).toBe(true);

    const required = renderHook(() => ({
      gemini: useUsageTrackingRequiredByPool("gemini"),
      cursor: useUsageTrackingRequiredByPool("cursor"),
    })).result.current;
    expect(required).toEqual({ gemini: true, cursor: false });
  });

  it("returns the stored list itself when no pool changes it", () => {
    configure(undefined, ["gemini", "cursor"]);
    const state = useSharedSettings.getState();
    expect(selectCollectedUsageDisabledProviders(state)).toBe(state.usage.disabledProviders);

    // Disabled pools and accounts left out of a pool are not collected for it.
    configure(
      {
        gemini: {
          enabled: true,
          members: ["gemini", "gemini:team"],
          excludedMembers: ["gemini"],
        },
      },
      ["gemini", "cursor"],
    );
    const next = useSharedSettings.getState();
    expect(selectCollectedUsageDisabledProviders(next)).toBe(next.usage.disabledProviders);
  });
});
