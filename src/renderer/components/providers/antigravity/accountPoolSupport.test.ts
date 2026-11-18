// ViscosityCode: Antigravity's account-pool explanation hook (fork of Poracode).
import { describe, expect, it, vi } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import {
  NATIVE_AGENT_REGISTRY_ENTRIES,
  nativeAgentAccountPoolUnavailableReason,
} from "@/renderer/views/SettingsOverlay/parts/agentRegistryNative";
import { isAgentProfileDriver } from "@/shared/contracts/agentProfiles";
import { antigravityAccountPoolUnavailableReason } from "./accountPoolSupport";

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  isWindows: () => false,
  isMac: () => true,
}));

describe("Antigravity account pool support", () => {
  it("is not a profile driver, so pools cannot accept Antigravity accounts", () => {
    expect(isAgentProfileDriver("antigravity")).toBe(false);
    const entry = NATIVE_AGENT_REGISTRY_ENTRIES.find((candidate) => candidate.id === "antigravity");
    expect(entry?.profiles).toBeUndefined();
    expect(entry?.accountPoolUnavailableReason).toBe(antigravityAccountPoolUnavailableReason);
  });

  it("explains the limit in plain words", () => {
    expect(i18n._(antigravityAccountPoolUnavailableReason)).toBe(
      "Antigravity keeps one sign-in per computer, so it can't join an account pool yet.",
    );
  });

  it("resolves the reason by base kind and omits it for providers with profiles", () => {
    expect(nativeAgentAccountPoolUnavailableReason("antigravity")).toBe(
      antigravityAccountPoolUnavailableReason,
    );
    expect(nativeAgentAccountPoolUnavailableReason("antigravity:second")).toBe(
      antigravityAccountPoolUnavailableReason,
    );
    expect(nativeAgentAccountPoolUnavailableReason("codex")).toBeUndefined();
    expect(nativeAgentAccountPoolUnavailableReason("codex:work")).toBeUndefined();
    expect(nativeAgentAccountPoolUnavailableReason("not-a-provider")).toBeUndefined();
  });

  it("never declares a reason next to working profiles", () => {
    const contradictory = NATIVE_AGENT_REGISTRY_ENTRIES.filter(
      (entry) =>
        entry.accountPoolUnavailableReason !== undefined &&
        (entry.profiles !== undefined || isAgentProfileDriver(entry.id)),
    ).map((entry) => entry.id);
    expect(contradictory).toEqual([]);
    const unregisteredProfiles = NATIVE_AGENT_REGISTRY_ENTRIES.filter(
      (entry) => entry.profiles !== undefined && !isAgentProfileDriver(entry.profiles.driver),
    ).map((entry) => entry.id);
    expect(unregisteredProfiles).toEqual([]);
  });
});
