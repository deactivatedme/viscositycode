// ViscosityCode: saved playbooks persist through the shared settings write path (fork of Poracode).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSharedSettings, type SharedSettings } from "@/shared/settings";
import type { SavedPlaybook } from "@/shared/viscosity/playbook";
import { useSharedSettings, waitForPendingSharedSettings } from "./sharedSettingsStore";

const originalPoracodeBridge = window.poracode;
const PLAYBOOK: SavedPlaybook = {
  id: "reversing",
  label: "Reversing",
  instructions: "Work like a reverse engineer.",
  switchPhrases: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
};

describe("sharedSettingsStore playbooks", () => {
  let writes: SharedSettings[];

  beforeEach(() => {
    localStorage.clear();
    writes = [];
    const setSharedSettings = vi.fn<(settings: SharedSettings) => Promise<void>>((settings) => {
      writes.push(settings);
      return Promise.resolve();
    });
    window.poracode = { setSharedSettings } as unknown as typeof window.poracode;
    useSharedSettings.setState({ playbooks: [] });
  });

  afterEach(() => {
    if (originalPoracodeBridge) window.poracode = originalPoracodeBridge;
    else Reflect.deleteProperty(window, "poracode");
  });

  it("round-trips a save through the host write and the host's parse", async () => {
    useSharedSettings.getState().setPlaybooks([PLAYBOOK]);
    await waitForPendingSharedSettings();
    expect(useSharedSettings.getState().playbooks).toEqual([PLAYBOOK]);
    const written = writes.at(-1);
    expect(written?.playbooks).toEqual([PLAYBOOK]);
    // The host rejects a write whose parsed value differs from what was sent.
    expect(normalizeSharedSettings(written).playbooks).toEqual([PLAYBOOK]);
    expect(JSON.parse(localStorage.getItem("poracode-shared-settings")!)).toMatchObject({
      playbooks: [PLAYBOOK],
    });
  });

  it("normalizes before writing so a malformed entry cannot reach the host", async () => {
    useSharedSettings.getState().setPlaybooks([PLAYBOOK, { ...PLAYBOOK, label: "" }]);
    await waitForPendingSharedSettings();
    expect(writes.at(-1)?.playbooks).toEqual([PLAYBOOK]);
  });

  it("omits the key instead of writing undefined when playbooks are absent", async () => {
    useSharedSettings.setState({ playbooks: undefined });
    useSharedSettings.getState().setAgentInstance({ id: "home", driver: "codex" });
    await waitForPendingSharedSettings();
    expect(writes.at(-1)).toBeDefined();
    expect(Object.hasOwn(writes.at(-1)!, "playbooks")).toBe(false);
  });
});
