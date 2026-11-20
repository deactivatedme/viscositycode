// ViscosityCode: staged live_re binary lookup (node-only).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { liveReBinaryCandidates, liveReBinaryPath, liveReTargetId } from "./liveReBinary";

let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("liveReTargetId", () => {
  it("maps the shipped hosts and nothing else", () => {
    expect(liveReTargetId("darwin", "arm64")).toBe("darwin-universal");
    expect(liveReTargetId("darwin", "x64")).toBe("darwin-universal");
    expect(liveReTargetId("win32", "x64")).toBe("win32-x64");
    expect(liveReTargetId("win32", "arm64")).toBe("win32-arm64");
    expect(liveReTargetId("win32", "ia32")).toBeUndefined();
    expect(liveReTargetId("linux", "x64")).toBeUndefined();
  });
});

describe("liveReBinaryPath", () => {
  it("finds the binary in the helpers dir, with .exe on Windows", () => {
    root = mkdtempSync(join(tmpdir(), "live-re-bin-"));
    const binary = join(root, "live-re", "win32-arm64", "viscosity-live-re.exe");
    mkdirSync(join(root, "live-re", "win32-arm64"), { recursive: true });
    writeFileSync(binary, "");
    expect(liveReBinaryPath({ helpersDir: root, platform: "win32", arch: "arm64", env: {} })).toBe(
      binary,
    );
    expect(
      liveReBinaryCandidates({
        platform: "darwin",
        arch: "arm64",
        env: { PORACODE_WSL_HELPERS_DIR: root },
      })[0],
    ).toBe(join(root, "live-re", "darwin-universal", "viscosity-live-re"));
  });

  it("lets the override win, and a missing override finds nothing", () => {
    root = mkdtempSync(join(tmpdir(), "live-re-bin-"));
    const explicit = join(root, "custom-live-re");
    writeFileSync(explicit, "");
    expect(liveReBinaryPath({ helpersDir: root, env: { VISCOSITY_LIVE_RE_BIN: explicit } })).toBe(
      explicit,
    );
    expect(
      liveReBinaryPath({ env: { VISCOSITY_LIVE_RE_BIN: join(root, "absent") } }),
    ).toBeUndefined();
  });

  it("has no candidates on Linux (WSL and SSH hosts)", () => {
    expect(liveReBinaryCandidates({ platform: "linux", arch: "x64", env: {} })).toEqual([]);
    expect(liveReBinaryPath({ platform: "linux", arch: "x64", env: {} })).toBeUndefined();
  });
});
