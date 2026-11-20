import { describe, expect, it } from "vitest";
import { type OsUserNameSources, osUserName, resolveOsUserName } from "./osUserName";

function sources(overrides: Partial<OsUserNameSources>): OsUserNameSources {
  return {
    platform: "darwin",
    username: () => "sam",
    run: () => {
      throw new Error("not available");
    },
    readFile: () => {
      throw new Error("not available");
    },
    ...overrides,
  };
}

describe("resolveOsUserName", () => {
  it("uses the macOS full name, and the login name when the lookup fails or is blank", () => {
    const calls: string[] = [];
    const run = (file: string, args: readonly string[]) => {
      calls.push([file, ...args].join(" "));
      return "Sam Doe\n";
    };
    expect(resolveOsUserName(sources({ run }))).toBe("Sam Doe");
    expect(calls).toEqual(["/usr/bin/id -F"]);
    expect(resolveOsUserName(sources({}))).toBe("sam");
    expect(resolveOsUserName(sources({ run: () => " \n" }))).toBe("sam");
  });

  it("uses the first GECOS field on Linux, and the login name without one", () => {
    const passwd = "root:x:0:0:root:/root:/bin/sh\nsam:x:1000:1000:Sam Doe,,,:/home/sam:/bin/sh\n";
    const linux = (readFile: OsUserNameSources["readFile"]) =>
      resolveOsUserName(sources({ platform: "linux", readFile }));
    expect(linux(() => passwd)).toBe("Sam Doe");
    expect(linux(() => "sam:x:1000:1000::/home/sam:/bin/sh\n")).toBe("sam");
    expect(linux(() => "root:x:0:0:root:/root:/bin/sh\n")).toBe("sam");
  });

  it("shows the login name on Windows without running anything", () => {
    expect(resolveOsUserName(sources({ platform: "win32" }))).toBe("sam");
  });

  it("never throws, drops control characters and caps the length", () => {
    const failing = sources({
      username: () => {
        throw new Error("locked down");
      },
    });
    expect(resolveOsUserName(failing)).toBeNull();
    expect(resolveOsUserName(sources({ run: () => "Sam\u0000\tDoe" }))).toBe("SamDoe");
    expect(resolveOsUserName(sources({ run: () => "x".repeat(200) }))).toHaveLength(80);
  });

  it("resolves the live account once", () => {
    const first = osUserName();
    expect(first === null || first.length > 0).toBe(true);
    expect(osUserName()).toBe(first);
  });
});
