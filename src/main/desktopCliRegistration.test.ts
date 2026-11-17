// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSelectedDesktopBundle } from "../../packages/poracode-cli/lib/desktopBundle.mjs";
import { registerPosixDesktopCli, shouldRegisterPosixDesktopCli } from "./desktopCliRegistration";

const effects = vi.hoisted(() => ({
  afterCreate: undefined as (() => void) | undefined,
  beforeCreate: undefined as (() => void) | undefined,
}));
vi.mock("../../packages/poracode-cli/lib/desktopBundle.mjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/poracode-cli/lib/desktopBundle.mjs")>()),
  readSelectedDesktopBundle: vi.fn<typeof readSelectedDesktopBundle>(),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    symlinkSync: vi.fn<typeof actual.symlinkSync>((...args) => {
      effects.beforeCreate?.();
      actual.symlinkSync(...args);
      effects.afterCreate?.();
    }),
  };
});

describe("desktop CLI registration admission", () => {
  const normal = {
    platform: "darwin" as const,
    isPackaged: true,
    isDev: false,
    baseDirOverride: undefined,
    env: {},
  };
  it("admits ordinary packaged macOS launches and excludes disposable/other-platform launches", () => {
    expect(shouldRegisterPosixDesktopCli(normal)).toBe(true);
    expect(shouldRegisterPosixDesktopCli({ ...normal, platform: "linux" })).toBe(true);
    for (const changed of [
      { platform: "win32" as const },
      { isPackaged: false },
      { isDev: true },
      { baseDirOverride: "/disposable-profile" },
      { env: { CI: "1" } },
      { env: { PORACODE_CDP_PORT: "9222" } },
      { env: { PORACODE_STARTUP_FAILURE_MODE: " quiet " } },
    ])
      expect(shouldRegisterPosixDesktopCli({ ...normal, ...changed })).toBe(false);
  });
});

// ViscosityCode: fixtures carry the fork's command names. The selected-bundle
// type comes from packages/poracode-cli, so the mocked bundle widens its
// command name and registration itself validates the fork's names.
type SelectedBundle = ReturnType<typeof readSelectedDesktopBundle>;
type BundleFixture = Omit<SelectedBundle, "commandName"> & { commandName: string };
const selectBundle = (fixture: BundleFixture) =>
  vi.mocked(readSelectedDesktopBundle).mockReturnValue(fixture as SelectedBundle);

// Real POSIX fixture operations exercise binding/record custody. The selected
// bundle is mocked here; native ASAR/Electron validation is a separate gate.
describe.skipIf(process.platform === "win32")("owned macOS command binding", () => {
  const scratch = resolve("tmp");
  let root: string;
  let input: Parameters<typeof registerPosixDesktopCli>[0];
  let bundle: BundleFixture;
  let recordPath: string;
  let linkPath: string;
  let lockPath: string;

  beforeEach(() => {
    effects.beforeCreate = undefined;
    effects.afterCreate = undefined;
    vi.clearAllMocks();
    mkdirSync(scratch, { recursive: true });
    root = mkdtempSync(join(scratch, "desktop-registration-"));
    const appDataDir = join(root, "Application Support");
    const bin = join(root, "owned bin");
    const resourcesDir = join(root, "ViscosityCode.app", "Contents", "Resources");
    const executablePath = join(root, "ViscosityCode.app", "Contents", "MacOS", "ViscosityCode");
    for (const directory of [
      appDataDir,
      bin,
      join(resourcesDir, "desktop-cli"),
      join(root, "ViscosityCode.app", "Contents", "MacOS"),
    ])
      mkdirSync(directory, { recursive: true });
    writeFileSync(executablePath, "owned selected executable");
    writeFileSync(join(resourcesDir, "desktop-cli", "viscositycode"), "owned selected command");
    input = {
      resourcesDir,
      executablePath,
      appVersion: "2.0.0",
      electronVersion: "44.4.4",
      channel: "stable",
      appDataDir,
      path: bin,
      platform: "darwin",
    };
    bundle = {
      formatVersion: 1,
      runtime: "electron-run-as-node",
      channel: "stable",
      commandName: "viscositycode",
      appVersion: "2.0.0",
      electronVersion: "44.4.4",
      platform: "darwin",
      executableName: "ViscosityCode",
      serverPrefixRelative: "app.asar/dist/cli-runtime",
      entryRelative: "lib/server.cjs",
      resourcesDir,
      prefix: join(resourcesDir, "app.asar", "dist", "cli-runtime"),
      entry: "unused selected entry",
      files: [{ path: "desktop-cli/viscositycode", bytes: 22, sha256: "a".repeat(64) }],
      sources: new Map(),
    };
    selectBundle(bundle);
    const stateDir = join(appDataDir, "viscositycode-desktop-cli-stable");
    recordPath = join(stateDir, "registration.json");
    lockPath = join(stateDir, "registration.lock");
    linkPath = join(bin, "viscositycode");
  });
  afterEach(() => {
    effects.beforeCreate = undefined;
    effects.afterCreate = undefined;
    if (!resolve(root).startsWith(`${scratch}${sep}`))
      throw new Error("Fixture escaped scratch root");
    rmSync(root, { recursive: true, force: true });
  });

  it("registers the exact selected command and revalidates it after an in-place update", () => {
    expect(registerPosixDesktopCli(input).state).toBe("registered");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(join(bundle.resourcesDir, "desktop-cli", "viscositycode"));
    const before = JSON.parse(readFileSync(recordPath, "utf8"));
    expect(before).toMatchObject({
      formatVersion: 1,
      state: "installed",
      channel: "stable",
      account: { kind: "uid", id: process.getuid?.() },
      launcherSha256: "a".repeat(64),
    });
    selectBundle({
      ...bundle,
      appVersion: "2.0.1",
      files: [{ path: "desktop-cli/viscositycode", bytes: 22, sha256: "b".repeat(64) }],
    });
    expect(registerPosixDesktopCli({ ...input, appVersion: "2.0.1" }).state).toBe("registered");
    expect(JSON.parse(readFileSync(recordPath, "utf8"))).toMatchObject({
      installationId: before.installationId,
      launcherSha256: "b".repeat(64),
      state: "installed",
    });
    expect(existsSync(lockPath)).toBe(false);
    expect(vi.mocked(symlinkSync)).toHaveBeenCalledTimes(1);
  });

  it("preserves an existing npm-style command, including a broken foreign symlink", () => {
    writeFileSync(linkPath, "existing npm command");
    expect(registerPosixDesktopCli(input).state).toBe("collision");
    expect(readFileSync(linkPath, "utf8")).toBe("existing npm command");
    expect(existsSync(recordPath)).toBe(false);
    unlinkSync(linkPath);
    symlinkSync("missing foreign runtime", linkPath);
    expect(registerPosixDesktopCli(input).state).toBe("collision");
    expect(readlinkSync(linkPath)).toBe("missing foreign runtime");
    expect(existsSync(recordPath)).toBe(false);
  });

  it("creates a user-bin fallback when Finder PATH contains no suitable directory", () => {
    const fallback = join(root, "home", ".local", "bin");
    const result = registerPosixDesktopCli({
      ...input,
      path: join(root, "missing-path"),
      fallbackDirectory: fallback,
    });
    expect(result).toMatchObject({
      state: "registered",
      linkPath: join(fallback, "viscositycode"),
    });
    expect(readlinkSync(join(fallback, "viscositycode"))).toBe(result.launcherPath);
    const previous = readFileSync(recordPath, "utf8");
    // A pre-upgrade format-1 record keeps its installation identity and location.
    expect(
      registerPosixDesktopCli({ ...input, path: fallback, fallbackDirectory: fallback }).state,
    ).toBe("registered");
    expect(readFileSync(recordPath, "utf8")).toBe(previous);
  });

  it("registers a durable AppImage shim and retains it across remounts and updates", () => {
    const image = join(root, "ViscosityCode Nightly's release.AppImage");
    writeFileSync(image, "owned AppImage fixture");
    const linux = { ...input, platform: "linux" as const, appImagePath: image };
    const result = registerPosixDesktopCli(linux);
    expect(result.state).toBe("registered");
    expect(readlinkSync(linkPath)).toBe(result.launcherPath);
    expect(result.launcherPath).toBe(
      join(input.appDataDir, "viscositycode-desktop-cli-stable", "viscositycode.sh"),
    );
    const before = JSON.parse(readFileSync(recordPath, "utf8"));
    expect(before.appExecutable).toBe(image);
    const wrapper = readFileSync(result.launcherPath, "utf8");
    expect(wrapper).toContain("process.env.APPDIR");
    expect(wrapper).not.toContain(input.resourcesDir);
    selectBundle({
      ...bundle,
      resourcesDir: join(root, "new ephemeral mount", "resources"),
      appVersion: "2.0.1",
      files: [{ path: "desktop-cli/viscositycode", bytes: 22, sha256: "b".repeat(64) }],
    });
    expect(registerPosixDesktopCli({ ...linux, appVersion: "2.0.1" }).state).toBe("registered");
    expect(JSON.parse(readFileSync(recordPath, "utf8"))).toMatchObject({
      installationId: before.installationId,
      appExecutable: image,
    });
    expect(readFileSync(result.launcherPath, "utf8")).toBe(wrapper);
    writeFileSync(result.launcherPath, "foreign changed wrapper");
    expect(() => registerPosixDesktopCli({ ...linux, appVersion: "2.0.1" })).toThrow(
      "launcher changed",
    );
    expect(readFileSync(result.launcherPath, "utf8")).toBe("foreign changed wrapper");
  });

  it("prefers an existing writable shell directory over creating the fallback", () => {
    const fallback = join(root, "home", ".local", "bin");
    expect(registerPosixDesktopCli({ ...input, fallbackDirectory: fallback }).state).toBe(
      "registered",
    );
    expect(existsSync(linkPath)).toBe(true);
    expect(existsSync(fallback)).toBe(false);
  });

  it("does not publish into a disposable version-manager directory on the shell PATH", () => {
    const fallback = join(root, "home", ".local", "bin");
    const broken = join(root, "broken bin");
    symlinkSync(join(root, "removed directory"), broken, "dir");
    expect(
      registerPosixDesktopCli({
        ...input,
        installationDirectories: [fallback, broken],
        fallbackDirectory: fallback,
      }),
    ).toMatchObject({ state: "registered", linkPath: join(fallback, "viscositycode") });
    expect(existsSync(linkPath)).toBe(false);
  });

  it("keeps Stable and Nightly commands and registration generations separate", () => {
    registerPosixDesktopCli(input);
    const stable = readFileSync(recordPath, "utf8");
    const nightlyLauncher = join(bundle.resourcesDir, "desktop-cli", "viscositycode-next");
    writeFileSync(nightlyLauncher, "owned selected nightly command");
    selectBundle({
      ...bundle,
      channel: "nightly",
      commandName: "viscositycode-next",
      files: [{ path: "desktop-cli/viscositycode-next", bytes: 30, sha256: "b".repeat(64) }],
    });
    expect(registerPosixDesktopCli({ ...input, channel: "nightly" }).state).toBe("registered");
    const nightly = JSON.parse(
      readFileSync(
        join(input.appDataDir, "viscositycode-desktop-cli-nightly", "registration.json"),
        "utf8",
      ),
    );
    expect(nightly.commandName).toBe("viscositycode-next");
    expect(nightly.installationId).not.toBe(JSON.parse(stable).installationId);
    expect(readlinkSync(join(input.path, "viscositycode-next"))).toBe(nightlyLauncher);
    expect(readFileSync(recordPath, "utf8")).toBe(stable);
  });

  it("does not shadow an existing command later on PATH", () => {
    const later = join(root, "later bin");
    mkdirSync(later);
    writeFileSync(join(later, "viscositycode"), "user-managed command");
    expect(registerPosixDesktopCli({ ...input, path: `${input.path}:${later}` }).state).toBe(
      "collision",
    );
    expect(existsSync(linkPath)).toBe(false);
  });

  it("registers the Nightly name while preserving an existing npm Stable command", () => {
    const npmCommand = join(input.path, "viscositycode");
    writeFileSync(npmCommand, "npm-owned command");
    const nightlyLauncher = join(bundle.resourcesDir, "desktop-cli", "viscositycode-next");
    writeFileSync(nightlyLauncher, "owned selected nightly command");
    selectBundle({
      ...bundle,
      channel: "nightly",
      commandName: "viscositycode-next",
      files: [{ path: "desktop-cli/viscositycode-next", bytes: 30, sha256: "b".repeat(64) }],
    });
    expect(registerPosixDesktopCli({ ...input, channel: "nightly" }).state).toBe("registered");
    expect(readFileSync(npmCommand, "utf8")).toBe("npm-owned command");
    expect(readlinkSync(join(input.path, "viscositycode-next"))).toBe(nightlyLauncher);
    expect(existsSync(recordPath)).toBe(false);
  });

  it("returns the exact bundled entry when no absolute existing PATH directory is available", () => {
    const result = registerPosixDesktopCli({
      ...input,
      path: `:relative:$HOME/bin:${join(root, "missing-absolute")}`,
    });
    expect(result.state).toBe("unavailable");
    expect(result.detail).toContain(join(bundle.resourcesDir, "desktop-cli", "viscositycode"));
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
  });

  // ViscosityCode: an upstream Poracode bundle's command is never published.
  it("refuses a selected bundle that advertises a non-ViscosityCode command", () => {
    selectBundle({
      ...bundle,
      commandName: "poracode",
      files: [{ path: "desktop-cli/poracode", bytes: 22, sha256: "a".repeat(64) }],
    });
    expect(() => registerPosixDesktopCli(input)).toThrow(/unknown bundled command name/u);
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
  });

  it("refuses future or extended registration records without replacing their bytes or binding", () => {
    registerPosixDesktopCli(input);
    const before = JSON.parse(readFileSync(recordPath, "utf8"));
    for (const changed of [
      { formatVersion: 2 },
      { future: true },
      { commandName: "viscositycode-nightly" },
      // ViscosityCode: an upstream Poracode record is never adopted.
      { commandName: "poracode" },
    ]) {
      const bytes = JSON.stringify({ ...before, ...changed });
      writeFileSync(recordPath, bytes);
      expect(() => registerPosixDesktopCli(input)).toThrow(Error);
      expect(readFileSync(recordPath, "utf8")).toBe(bytes);
      expect(readlinkSync(linkPath)).toBe(before.launcherPath);
      expect(existsSync(lockPath)).toBe(false);
    }
  });

  it("refuses another account or desktop installation instead of adopting its binding", () => {
    registerPosixDesktopCli(input);
    const before = JSON.parse(readFileSync(recordPath, "utf8"));
    for (const changed of [
      { account: { kind: "uid", id: before.account.id + 1 } },
      { appExecutable: join(root, "different executable") },
    ]) {
      const bytes = JSON.stringify({ ...before, ...changed });
      writeFileSync(recordPath, bytes);
      expect(() => registerPosixDesktopCli(input)).toThrow(
        "different desktop installation or account",
      );
      expect(readFileSync(recordPath, "utf8")).toBe(bytes);
    }
  });

  it("recovers a prepared exact-target binding without choosing another command directory", () => {
    registerPosixDesktopCli(input);
    const before = JSON.parse(readFileSync(recordPath, "utf8"));
    writeFileSync(recordPath, JSON.stringify({ ...before, state: "prepared" }));
    unlinkSync(linkPath);
    expect(registerPosixDesktopCli(input).state).toBe("registered");
    expect(JSON.parse(readFileSync(recordPath, "utf8"))).toMatchObject({
      installationId: before.installationId,
      state: "installed",
    });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    expect(registerPosixDesktopCli({ ...input, path: elsewhere }).state).toBe("unavailable");
    expect(existsSync(join(elsewhere, "viscositycode"))).toBe(false);
  });

  it("preserves a concurrent command arrival and retains prepared custody", () => {
    effects.beforeCreate = () => {
      writeFileSync(linkPath, "concurrent foreign command");
    };
    expect(() => registerPosixDesktopCli(input)).toThrow(Error);
    expect(readFileSync(linkPath, "utf8")).toBe("concurrent foreign command");
    expect(JSON.parse(readFileSync(recordPath, "utf8")).state).toBe("prepared");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("stops publication and retains a changed claim instead of removing foreign custody", () => {
    effects.afterCreate = () => {
      writeFileSync(lockPath, "foreign replacement claim");
    };
    expect(() => registerPosixDesktopCli(input)).toThrow("claim changed");
    expect(readFileSync(lockPath, "utf8")).toBe("foreign replacement claim");
    expect(JSON.parse(readFileSync(recordPath, "utf8")).state).toBe("prepared");
    expect(readlinkSync(linkPath)).toBe(join(bundle.resourcesDir, "desktop-cli", "viscositycode"));
  });

  it("refuses a replaced claim even when its nonce bytes were copied", () => {
    let copied = "";
    effects.afterCreate = () => {
      copied = readFileSync(lockPath, "utf8");
      unlinkSync(lockPath);
      writeFileSync(lockPath, copied);
    };
    expect(() => registerPosixDesktopCli(input)).toThrow("claim changed");
    expect(readFileSync(lockPath, "utf8")).toBe(copied);
    expect(JSON.parse(readFileSync(recordPath, "utf8")).state).toBe("prepared");
  });

  it("preserves future metadata arriving after the command was published", () => {
    let futureBytes = "";
    effects.afterCreate = () => {
      futureBytes = JSON.stringify({
        ...JSON.parse(readFileSync(recordPath, "utf8")),
        formatVersion: 2,
      });
      writeFileSync(recordPath, futureBytes);
    };
    expect(() => registerPosixDesktopCli(input)).toThrow("metadata changed");
    expect(readFileSync(recordPath, "utf8")).toBe(futureBytes);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("does not steal an existing registration claim", () => {
    const stateDir = join(input.appDataDir, "viscositycode-desktop-cli-stable");
    mkdirSync(stateDir, { mode: 0o700 });
    writeFileSync(lockPath, "existing claim");
    expect(() => registerPosixDesktopCli(input)).toThrow(Error);
    expect(readFileSync(lockPath, "utf8")).toBe("existing claim");
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
  });

  it("does not follow a linked registration directory", () => {
    const foreign = join(root, "foreign record directory");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "keep.json"), "foreign bytes");
    symlinkSync(foreign, join(input.appDataDir, "viscositycode-desktop-cli-stable"), "dir");
    expect(() => registerPosixDesktopCli(input)).toThrow("not private and owned");
    expect(readFileSync(join(foreign, "keep.json"), "utf8")).toBe("foreign bytes");
    expect(existsSync(join(foreign, "registration.lock"))).toBe(false);
    expect(existsSync(linkPath)).toBe(false);
  });

  it("refuses a mismatched package before registration state exists", () => {
    selectBundle({ ...bundle, channel: "nightly" });
    expect(() => registerPosixDesktopCli(input)).toThrow("different channel or app version");
    expect(existsSync(recordPath)).toBe(false);
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(join(input.appDataDir, "viscositycode-desktop-cli-stable"))).toBe(false);
  });
});
