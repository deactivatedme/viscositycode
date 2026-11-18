import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_INSTANCE_REMOVAL_FIELDS,
  removeAgentInstanceSettings,
} from "@/shared/agentInstanceSettings";
import { defaultSharedSettings, type SharedSettingsInput } from "@/shared/settings";
import {
  SETTINGS_MISSING_REVISION,
  SETTINGS_TRANSACTION_VERSION,
  settingsEditSchema,
  settingsSubjectId,
  type SettingsSnapshot,
  type SettingsSubject,
} from "@/shared/settingsTransactions";
import { SettingsAuthority } from "./SettingsAuthority";
import { SettingsCompatWriter } from "./settingsCompatWrites";
import {
  SettingsDocumentError,
  decodeSettingsDocument,
  preserveUnknownSettingsValues,
} from "./settingsDocument";

// ViscosityCode: `accountPools` is an additive settings field (no document
// version bump). These start from documents written before and after it.
const POOLS = {
  codex: { enabled: true, members: ["codex", "codex:work"], switchAtPercent: 90 },
  claude: { enabled: false, members: ["claude"] },
};

describe("account pools in the settings document", () => {
  it("loads a pre-pools v3 document with empty pools and keeps every saved value", () => {
    const saved = {
      $poracodeSettingsVersion: 3,
      themeMode: "light",
      disabledAgents: ["gemini"],
      agentInstances: { work: { id: "work", driver: "codex", displayName: "Work" } },
      usage: { disabledProviders: ["gemini"] },
      futureSetting: { keep: true },
    };
    const document = decodeSettingsDocument(saved);
    expect(document.settings.accountPools).toEqual({});
    expect(document.settings).toMatchObject({
      themeMode: "light",
      disabledAgents: ["gemini"],
      agentInstances: saved.agentInstances,
    });
    expect(document.settings.usage.disabledProviders).toEqual(["gemini"]);
    expect(document.raw.futureSetting).toEqual({ keep: true });
  });

  it("round-trips saved pools as written, including future drivers and pool keys", () => {
    const saved = {
      $poracodeSettingsVersion: 3,
      accountPools: {
        ...POOLS,
        // A driver this build has no profiles for and a key a newer build added.
        futuredriver: { enabled: true, members: ["futuredriver"], futureKey: 1 },
      },
    };
    const document = decodeSettingsDocument(saved);
    expect(document.settings.accountPools).toEqual({
      ...POOLS,
      futuredriver: { enabled: true, members: ["futuredriver"] },
    });
    expect(document.raw.accountPools).toEqual(saved.accountPools);
    const again = decodeSettingsDocument(JSON.parse(JSON.stringify(document.raw)));
    expect(again.raw.accountPools).toEqual(saved.accountPools);
    expect(again.settings.accountPools).toEqual(document.settings.accountPools);
  });

  it("refuses a present invalid pool instead of repairing it", () => {
    expect(() =>
      decodeSettingsDocument({ accountPools: { codex: { enabled: true, members: "codex" } } }),
    ).toThrow(SettingsDocumentError);
  });
});

describe("account pools through the settings authority", () => {
  let root: string;
  let settingsPath: string;
  let generation: string;
  const authorities: SettingsAuthority[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "settings-account-pools-"));
    settingsPath = join(root, "settings.json");
    generation = randomUUID();
  });
  afterEach(async () => {
    await Promise.all(authorities.splice(0).map((authority) => authority.close()));
    await rm(root, { recursive: true, force: true });
  });

  async function open(contents?: Record<string, unknown>) {
    if (contents) await writeFile(settingsPath, JSON.stringify(contents));
    const authority = await SettingsAuthority.open({
      // Explicit unit admission stub; this suite does not qualify SQLite preparation.
      assertPreparedDatabaseForWrite: () => {},
      lease: {
        paths: { dataRoot: root },
        generation,
        assertActive: (expected) => {
          if (expected !== generation) throw new Error("Fixture lease is inactive");
        },
      },
    });
    authorities.push(authority);
    return authority;
  }

  function setEntry(snapshot: SettingsSnapshot, subject: SettingsSubject, value: unknown) {
    return {
      version: SETTINGS_TRANSACTION_VERSION,
      authorityId: snapshot.authorityId,
      edits: [
        settingsEditSchema.parse({
          operation: "set",
          subject,
          value,
          expectedRevision:
            snapshot.revisions[settingsSubjectId(subject)] ?? SETTINGS_MISSING_REVISION,
        }),
      ],
    };
  }

  it("merges edits to different pools made from the same pre-pools snapshot", async () => {
    const authority = await open({ $poracodeSettingsVersion: 3, themeMode: "dark" });
    const before = authority.snapshot();
    const codex: SettingsSubject = { kind: "entry", field: "accountPools", key: "codex" };
    const claude: SettingsSubject = { kind: "entry", field: "accountPools", key: "claude" };
    const results = await Promise.all([
      authority.mutate(setEntry(before, codex, POOLS.codex), () => true),
      authority.mutate(setEntry(before, claude, POOLS.claude), () => true),
    ]);
    expect(results.map((result) => result.status)).toEqual(["committed", "committed"]);
    expect(authority.readSettings().accountPools).toEqual(POOLS);
    const disk = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(disk.accountPools).toEqual(POOLS);

    await authority.close();
    authorities.splice(0);
    const reopened = await open();
    expect(reopened.readSettings().accountPools).toEqual(POOLS);
  });

  it("keeps saved pools when a whole-snapshot writer omits the field", async () => {
    const authority = await open({ ...defaultSharedSettings, accountPools: POOLS });
    const writes = new SettingsCompatWriter(authority);
    const { accountPools: _omitted, ...withoutPools } = authority.readSettings();
    const settings = await writes.commitCompatSnapshot({
      ...withoutPools,
      themeMode: "light",
    } as SharedSettingsInput);
    expect(settings.themeMode).toBe("light");
    expect(settings.accountPools).toEqual(POOLS);
  });

  it("commits pools written by a whole-snapshot writer (the desktop renderer store)", async () => {
    const authority = await open({ ...defaultSharedSettings, accountPools: POOLS });
    const writes = new SettingsCompatWriter(authority);
    const next = {
      ...POOLS,
      codex: { ...POOLS.codex, members: ["codex:work", "codex"], switchAtPercent: 95 },
    };
    const settings = await writes.commitCompatSnapshot({
      ...authority.readSettings(),
      accountPools: next,
    } as SharedSettingsInput);
    expect(settings.accountPools).toEqual(next);
    const disk = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(disk.accountPools).toEqual(next);
  });

  it("removes a deleted profile from its pool in the host removal transaction", async () => {
    const instance = { id: "work", driver: "codex", displayName: "Work" } as const;
    const authority = await open({
      ...defaultSharedSettings,
      agentInstances: { work: instance },
      accountPools: POOLS,
    });
    const writes = new SettingsCompatWriter(authority);
    const result = await writes.editSettingsFields(AGENT_INSTANCE_REMOVAL_FIELDS, (current) =>
      removeAgentInstanceSettings(current, instance),
    );
    expect(result.status).toBe("committed");
    expect(authority.readSettings().agentInstances).toEqual({});
    expect(authority.readSettings().accountPools).toEqual({
      ...POOLS,
      codex: { ...POOLS.codex, members: ["codex"] },
    });
  });
});

// ViscosityCode: pool shape v2 adds the optional `excludedMembers` list (accounts
// the owner left out). Pre-upgrade documents must load and write back unchanged.
describe("left-out pool members in the settings document (pool shape v2)", () => {
  const WITH_EXCLUSIONS = {
    codex: {
      enabled: true,
      members: ["codex", "codex:work", "codex:home"],
      excludedMembers: ["codex:work"],
    },
  };

  it("loads a pre-exclusion pool document without materializing the new key", () => {
    const saved = { $poracodeSettingsVersion: 3, accountPools: POOLS };
    const document = decodeSettingsDocument(saved);
    expect(document.settings.accountPools).toEqual(POOLS);
    expect(Object.hasOwn(document.settings.accountPools!.codex!, "excludedMembers")).toBe(false);
    expect(document.raw.accountPools).toEqual(POOLS);
  });

  it("round-trips an exclusion list as written", () => {
    const document = decodeSettingsDocument({
      $poracodeSettingsVersion: 3,
      accountPools: WITH_EXCLUSIONS,
    });
    expect(document.settings.accountPools).toEqual(WITH_EXCLUSIONS);
    const again = decodeSettingsDocument(JSON.parse(JSON.stringify(document.raw)));
    expect(again.settings.accountPools).toEqual(WITH_EXCLUSIONS);
  });

  it("keeps the exclusions on disk when an older reader writes the same pool back", () => {
    // An older build's pool schema has no `excludedMembers`: it parses the pool
    // without it and writes its own edit without it.
    const { excludedMembers: _unknownToOlderReaders, ...olderView } = WITH_EXCLUSIONS.codex;
    const olderEdit = { ...olderView, switchAtPercent: 95 };
    const merged = preserveUnknownSettingsValues(
      { codex: WITH_EXCLUSIONS.codex },
      { codex: olderView },
      { codex: olderEdit },
    );
    expect(merged).toEqual({
      codex: { ...olderEdit, excludedMembers: ["codex:work"] },
    });
  });

  it("commits an exclusion edit through the settings authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "settings-account-pool-exclusions-"));
    const generation = randomUUID();
    try {
      await writeFile(
        join(root, "settings.json"),
        JSON.stringify({ ...defaultSharedSettings, accountPools: POOLS }),
      );
      const authority = await SettingsAuthority.open({
        assertPreparedDatabaseForWrite: () => {},
        lease: {
          paths: { dataRoot: root },
          generation,
          assertActive: (expected) => {
            if (expected !== generation) throw new Error("Fixture lease is inactive");
          },
        },
      });
      try {
        const writes = new SettingsCompatWriter(authority);
        const next = { ...POOLS, codex: { ...POOLS.codex, excludedMembers: ["codex:work"] } };
        const settings = await writes.commitCompatSnapshot({
          ...authority.readSettings(),
          accountPools: next,
        } as SharedSettingsInput);
        expect(settings.accountPools).toEqual(next);
        const disk = JSON.parse(await readFile(join(root, "settings.json"), "utf8")) as Record<
          string,
          unknown
        >;
        expect(disk.accountPools).toEqual(next);
      } finally {
        await authority.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
