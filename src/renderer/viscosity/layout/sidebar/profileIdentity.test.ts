import { afterEach, describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@/shared/contracts";
import {
  cleanProfileName,
  pickProfileName,
  profileInitial,
  readOsUserName,
} from "./profileIdentity";

function snapshot(providerId: string, overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return { providerId, status: "ok", windows: [], fetchedAt: 1, ...overrides } as UsageSnapshot;
}

const RANK: Record<string, number> = { first: 1, second: 2, third: 3 };
const rank = (id: string) => RANK[id] ?? 99;
const snapshots = {
  third: snapshot("third", { authenticatedAs: "z@x.dev", plan: "Free" }),
  second: snapshot("second", { authenticatedAs: "sam@example.com", plan: "Pro" }),
  first: snapshot("first", { status: "auth-missing", authenticatedAs: "no@x.dev" }),
};

const shellGlobal = globalThis as { viscosityHost?: unknown };

afterEach(() => {
  delete shellGlobal.viscosityHost;
});

describe("pickProfileName", () => {
  it("prefers the typed name, then the OS account name", () => {
    const input = { customName: "Sammy", osUserName: "Sam Doe", snapshots, rank };
    expect(pickProfileName(input)).toBe("Sammy");
    expect(pickProfileName({ ...input, customName: null })).toBe("Sam Doe");
  });

  it("falls back to the first OK account's local part in provider rank order", () => {
    expect(pickProfileName({ customName: null, osUserName: null, snapshots, rank })).toBe("sam");
    // A plan-only or handle-only account names nobody: the next one does.
    const planOnlyFirst = {
      first: snapshot("first", { plan: "Ultra" }),
      second: snapshot("second", { authenticatedAs: "@handle" }),
      third: snapshot("third", { authenticatedAs: "ana" }),
    };
    expect(
      pickProfileName({ customName: null, osUserName: null, snapshots: planOnlyFirst, rank }),
    ).toBe("ana");
  });

  it("returns null when nobody is named", () => {
    const none = { customName: null, osUserName: null, rank };
    expect(pickProfileName({ ...none, snapshots: {} })).toBeNull();
    expect(pickProfileName({ ...none, snapshots: { first: snapshot("first") } })).toBeNull();
  });
});

describe("readOsUserName", () => {
  it("reads the shell's user name", () => {
    shellGlobal.viscosityHost = { system: { totalMemoryBytes: 1, userName: "  Sam Doe " } };
    expect(readOsUserName()).toBe("Sam Doe");
  });

  it("is null for a browser client, an older shell and a value that is not a name", () => {
    expect(readOsUserName()).toBeNull();
    for (const system of [
      undefined,
      {},
      { userName: "   " },
      { userName: 7 },
      { userName: null },
    ]) {
      shellGlobal.viscosityHost = { system };
      expect(readOsUserName()).toBeNull();
    }
  });
});

describe("cleanProfileName", () => {
  it("trims, caps at 80 characters and rejects blanks and non-strings", () => {
    expect(cleanProfileName("  Sam  ")).toBe("Sam");
    expect(cleanProfileName("x".repeat(200))).toHaveLength(80);
    expect(cleanProfileName("  ")).toBeNull();
    expect(cleanProfileName(null)).toBeNull();
  });
});

describe("profileInitial", () => {
  it("initials the shown name", () => {
    expect(profileInitial("sam doe")).toBe("S");
    expect(profileInitial("Account")).toBe("A");
  });
});
