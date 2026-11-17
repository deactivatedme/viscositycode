// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairLegacyMacAppPath } from "./macAppPathMigration";

// ViscosityCode: the fork has no pre-rebrand macOS bundle to bridge, so the
// upstream Dock-tile symlink repair is a no-op on every platform.
describe("repairLegacyMacAppPath", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "viscositycode-mac-app-path-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function packagedExecutable(appName: string): string {
    const executablePath = join(root, appName, "Contents", "MacOS", appName.replace(/\.app$/u, ""));
    mkdirSync(join(root, appName, "Contents", "MacOS"), { recursive: true });
    writeFileSync(executablePath, "executable");
    return executablePath;
  }

  it("never creates a legacy app path next to a packaged macOS bundle", () => {
    for (const [channel, appName] of [
      ["stable", "ViscosityCode.app"],
      ["nightly", "ViscosityCode Nightly.app"],
    ] as const) {
      const executablePath = packagedExecutable(appName);
      expect(
        repairLegacyMacAppPath(channel, { platform: "darwin", isPackaged: true, executablePath }),
      ).toBe("skipped");
    }
    expect(readdirSync(root).toSorted()).toEqual([
      "ViscosityCode Nightly.app",
      "ViscosityCode.app",
    ]);
  });

  it("skips unpackaged and non-macOS launches", () => {
    const executablePath = packagedExecutable("ViscosityCode.app");
    expect(
      repairLegacyMacAppPath("stable", { platform: "linux", isPackaged: true, executablePath }),
    ).toBe("skipped");
    expect(
      repairLegacyMacAppPath("stable", { platform: "darwin", isPackaged: false, executablePath }),
    ).toBe("skipped");
    expect(repairLegacyMacAppPath("stable")).toBe("skipped");
    expect(readdirSync(root)).toEqual(["ViscosityCode.app"]);
  });
});
