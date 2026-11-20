import { describe, expect, it } from "vitest";
import {
  isThreadConfigEqual,
  projectDraftConfigSchema,
  retainThreadToolOverrides,
  threadConfigSchema,
} from "../contracts/config";
import { remoteSettingsWireSchema } from "../remote/contract/routeSchemas";
import { pickRemoteSettings, remoteSettingsPatchSchema, remoteSettingsSchema } from "../remote";
import { defaultSharedSettings, normalizeSharedSettings } from "../settings";
import {
  MAX_PLAYBOOK_PHRASES,
  MAX_SAVED_PLAYBOOKS,
  PLAYBOOK_PHRASE_MAX_LENGTH,
  isThreadConfigPlaybookEqual,
  normalizeSavedPlaybooks,
  playbookBindingFromSaved,
  playbookFingerprint,
  sanitizePlaybookPhrase,
  sanitizePlaybookPhrases,
  savedPlaybookSchema,
  threadConfigPlaybookSchema,
  threadPlaybookBinding,
  type SavedPlaybook,
} from "./playbook";

const binding = {
  version: 1 as const,
  id: "reversing",
  label: "Reversing",
  icon: "binary",
  instructions: "Triage first.",
  themeId: "war-room",
  switchPhrases: ["WEAPONS FREE", "DISASSEMBLING TARGET"],
  exitPhrases: ["STAND DOWN"],
  mcpServerIds: ["srv-ghidra"],
};

const saved: SavedPlaybook = {
  id: "c-0a1b2c3d",
  label: "Firmware",
  instructions: "Dump the flash first.",
  description: "Firmware triage",
  mcp: ["ghidra"],
  switchPhrases: ["BREACHING"],
};

describe("thread playbook binding", () => {
  it("parses v1 strictly and keeps a future version verbatim and inert", () => {
    expect(threadConfigPlaybookSchema.parse(binding)).toEqual(binding);
    expect(threadConfigPlaybookSchema.safeParse({ ...binding, extra: 1 }).success).toBe(false);
    const future = { version: 2, id: "x", nested: { kept: true } };
    expect(threadConfigSchema.parse({ model: "m", playbook: future }).playbook).toEqual(future);
    expect(threadPlaybookBinding({ playbook: future })).toBeUndefined();
    expect(threadPlaybookBinding({ playbook: null })).toBeUndefined();
    expect(threadPlaybookBinding({})).toBeUndefined();
    expect(threadPlaybookBinding({ playbook: binding })).toEqual(binding);
  });

  it("rejects unsafe theme ids and unsanitized phrases", () => {
    expect(threadConfigPlaybookSchema.safeParse({ ...binding, themeId: "../x" }).success).toBe(
      false,
    );
    expect(
      threadConfigPlaybookSchema.safeParse({ ...binding, themeId: "custom:night" }).success,
    ).toBe(true);
    for (const phrase of [" PAD", "TWO\nLINES", "A".repeat(PLAYBOOK_PHRASE_MAX_LENGTH + 1), ""]) {
      expect(
        threadConfigPlaybookSchema.safeParse({ ...binding, switchPhrases: [phrase] }).success,
      ).toBe(false);
    }
    expect(
      threadConfigPlaybookSchema.safeParse({
        ...binding,
        exitPhrases: Array.from({ length: MAX_PLAYBOOK_PHRASES + 1 }, (_, i) => `L${i}`),
      }).success,
    ).toBe(false);
  });

  it("fingerprints only what the agent is told", () => {
    const base = playbookFingerprint(binding);
    expect(
      playbookFingerprint({
        ...binding,
        icon: "bug",
        mcpServerIds: [],
        themeId: "other",
        switchPhrases: ["X"],
      }),
    ).toBe(base);
    expect(playbookFingerprint({ ...binding, instructions: "Other." })).not.toBe(base);
    expect(playbookFingerprint({ ...binding, readOnly: true })).not.toBe(base);
    expect(playbookFingerprint(undefined)).toBe("");
  });

  it("compares structurally and treats null like absence", () => {
    expect(isThreadConfigPlaybookEqual(null, undefined)).toBe(true);
    expect(isThreadConfigPlaybookEqual(binding, { ...binding })).toBe(true);
    expect(isThreadConfigPlaybookEqual(binding, { ...binding, themeId: "x" })).toBe(false);
  });

  it("freezes a catalog entry into a v1 copy", () => {
    expect(playbookBindingFromSaved(saved, ["a", "a", "b"])).toEqual({
      version: 1,
      id: saved.id,
      label: saved.label,
      instructions: saved.instructions,
      switchPhrases: ["BREACHING"],
      mcpServerIds: ["a", "b"],
    });
  });
});

describe("thread config playbook (pre-upgrade)", () => {
  it("parses a stored config without a playbook unchanged", () => {
    const old = { model: "fixture", browserMcp: false, crew: null };
    expect(threadConfigSchema.parse(old)).toEqual(old);
    expect(projectDraftConfigSchema.parse({ ...old, agentKind: "a" })).not.toHaveProperty(
      "playbook",
    );
  });

  it("retains a playbook an older writer omitted and clears it on explicit null", () => {
    expect(
      retainThreadToolOverrides({ model: "new" }, { model: "old", playbook: binding }),
    ).toEqual({ model: "new", playbook: binding });
    expect(
      retainThreadToolOverrides(
        { model: "new", playbook: null },
        { model: "old", playbook: binding },
      ),
    ).toEqual({ model: "new", playbook: null });
  });

  it("makes a playbook-only change a real config update", () => {
    expect(isThreadConfigEqual({ model: "m" }, { model: "m", playbook: binding })).toBe(false);
    expect(isThreadConfigEqual({ model: "m" }, { model: "m", playbook: null })).toBe(true);
  });
});

describe("saved playbooks host setting", () => {
  it("adds an empty list to pre-playbook settings without changing other values", () => {
    const legacy: Record<string, unknown> = { ...defaultSharedSettings, crews: [] };
    delete legacy["playbooks"];
    const normalized = normalizeSharedSettings(legacy);
    expect(normalized.playbooks).toEqual([]);
    expect(normalized.crews).toEqual([]);
    expect(normalized.accountPools).toEqual(defaultSharedSettings.accountPools);
  });

  it("round-trips valid entries and drops malformed or duplicate ones alone", () => {
    const normalized = normalizeSharedSettings({
      ...defaultSharedSettings,
      playbooks: [
        saved,
        { id: "BAD ID", label: "x", instructions: "y" },
        { ...saved, label: "Dup" },
      ],
    });
    expect(normalized.playbooks).toEqual([saved]);
  });

  it("canonicalizes hand-edited phrases instead of losing the playbook", () => {
    const [entry] = normalizeSavedPlaybooks([
      { ...saved, switchPhrases: ["  ENGAGE\n NOW ", "", 7, "ENGAGE NOW"], exitPhrases: [""] },
    ]);
    expect(entry?.switchPhrases).toEqual(["ENGAGE NOW"]);
    expect(entry).not.toHaveProperty("exitPhrases");
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_SAVED_PLAYBOOKS + 5 }, (_, i) => ({
      ...saved,
      id: `c-${String(i).padStart(8, "0")}`,
    }));
    expect(normalizeSavedPlaybooks(many)).toHaveLength(MAX_SAVED_PLAYBOOKS);
  });

  it("keeps ten phrases and stored six-phrase lists from the earlier cap unchanged", () => {
    expect(MAX_PLAYBOOK_PHRASES).toBe(10);
    const ten = Array.from({ length: 10 }, (_, i) => `LINE ${i}`);
    const six = ten.slice(0, 6);
    expect(normalizeSavedPlaybooks([{ ...saved, switchPhrases: ten }])[0]?.switchPhrases).toEqual(
      ten,
    );
    expect(normalizeSavedPlaybooks([{ ...saved, exitPhrases: six }])[0]?.exitPhrases).toEqual(six);
    expect(threadPlaybookBinding({ playbook: { ...binding, switchPhrases: ten } })).toEqual({
      ...binding,
      switchPhrases: ten,
    });
    expect(sanitizePlaybookPhrases([...ten, "ELEVEN"])).toEqual(ten);
  });

  it("sanitizes phrases to one capped line", () => {
    expect(sanitizePlaybookPhrase("a‮\u0000b\tc")).toBe("a b c");
    expect(sanitizePlaybookPhrase("x".repeat(80))).toHaveLength(PLAYBOOK_PHRASE_MAX_LENGTH);
    expect(sanitizePlaybookPhrases(["A", "A", " ", ...Array(10).fill("B")])).toEqual(["A", "B"]);
    expect(savedPlaybookSchema.safeParse({ ...saved, switchPhrases: [] }).success).toBe(false);
  });
});

describe("remote playbooks sync", () => {
  it("carries playbooks when present and accepts hosts that predate them", () => {
    const withPlaybooks = pickRemoteSettings({ ...defaultSharedSettings, playbooks: [saved] });
    expect(remoteSettingsSchema.parse(withPlaybooks).playbooks).toEqual([saved]);
    expect(remoteSettingsPatchSchema.parse({ playbooks: [saved] }).playbooks).toEqual([saved]);
    const legacy: Record<string, unknown> = { ...withPlaybooks };
    delete legacy["playbooks"];
    expect(remoteSettingsSchema.parse(legacy)).not.toHaveProperty("playbooks");
    expect(remoteSettingsWireSchema.parse(legacy)).not.toHaveProperty("playbooks");
    expect(remoteSettingsWireSchema.parse(withPlaybooks).playbooks).toEqual([saved]);
  });
});
