// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { resolve, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { FORK_GITHUB_REPOSITORY } from "@/shared/viscosityRelease";
import {
  defaultInstallerPrefix,
  RELEASE_REPOSITORY,
  requireReleaseRepository,
  SelfUpdateError,
} from "./installerPrefix";

describe("installerPrefix", () => {
  it("resolves the installer's default prefix like the installers do", () => {
    expect(defaultInstallerPrefix({ platform: "linux", env: {}, home: "/home/u" })).toBe(
      "/home/u/.local/share/poracode/server",
    );
    expect(
      defaultInstallerPrefix({
        platform: "linux",
        env: { PORACODE_INSTALL_DIR: " rel/dir " },
        home: "/home/u",
      }),
    ).toBe(resolve("rel/dir"));
    expect(
      defaultInstallerPrefix({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" },
        home: "C:\\Users\\a",
      }),
    ).toBe(win32.join("C:\\Users\\a\\AppData\\Local", "Poracode", "server"));
    expect(defaultInstallerPrefix({ platform: "win32", env: {}, home: "C:\\Users\\a" })).toBe(
      win32.join("C:\\Users\\a", "AppData", "Local", "Poracode", "server"),
    );
  });

  // ViscosityCode: CLI releases never come from the upstream repository.
  it("takes the release repository from the fork configuration only", () => {
    expect(RELEASE_REPOSITORY).toBe(FORK_GITHUB_REPOSITORY);
    expect(RELEASE_REPOSITORY).not.toMatch(/Porabuild|Poracode/u);
  });

  it("refuses self-update and downloads before any request without a fork repository", () => {
    for (const missing of ["", "   "]) {
      expect(() => requireReleaseRepository(missing)).toThrow(SelfUpdateError);
      expect(() => requireReleaseRepository(missing)).toThrow(
        /has no release repository configured/u,
      );
    }
    expect(requireReleaseRepository(" acme/viscosity-code ")).toBe("acme/viscosity-code");
  });

  it.skipIf(FORK_GITHUB_REPOSITORY.trim() !== "")(
    "refuses by default while the fork has no release repository",
    () => {
      expect(() => requireReleaseRepository()).toThrow(SelfUpdateError);
    },
  );
});
