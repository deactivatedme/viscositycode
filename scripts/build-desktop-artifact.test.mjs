// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { SUPPORTED_LOCALES } from "../src/shared/locale.ts";
import {
  buildElectronBuilderConfig,
  wantsMacAdhocSigning,
  buildStagePackageJson,
  resolveAzureSignOptions,
  resolveUpdateRepository,
  verifyPackagedWinPtyOwners,
  verifyLockedComputerUseResources,
} from "./build-desktop-artifact.mjs";

// ViscosityCode: run `body` with packaging env vars replaced, then restore them.
function withPackagingEnv(values, body) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

void test("pins runtime, required peers and packaging tools to installed versions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "desktop-stage-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const installed = {};
  for (const name of [...Object.keys(pkg.dependencies), "electron", "electron-builder"]) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    installed[name] = "1.2.3";
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        version: installed[name],
        ...(name === "ws"
          ? {
              peerDependencies: { react: "*", typescript: "*" },
              peerDependenciesMeta: { typescript: { optional: true } },
            }
          : {}),
      }),
    );
  }
  const stage = buildStagePackageJson(pkg, root);
  assert.ok(Object.keys(stage.dependencies).length >= 19);
  for (const [name, version] of Object.entries({ ...stage.dependencies, ...stage.devDependencies }))
    assert.equal(version, installed[name]);
  assert.equal(stage.dependencies.react, "1.2.3");
  assert.equal(stage.dependencies.qrcode, installed.qrcode);
  assert.equal(stage.dependencies.typescript, undefined);
  assert.deepEqual(stage.overrides, pkg.overrides);
  rmSync(join(root, "ws", "package.json"));
  assert.throws(() => buildStagePackageJson(pkg, root), /not installed/);
});

void test("preserves supported Electron locales on Windows/Linux and macOS", () => {
  const config = parse(buildElectronBuilderConfig());
  // electron-builder matches literal tags or a wanted tag starting with language + '-'/'_'.
  const keeps = (language) =>
    config.electronLanguages.some(
      (wanted) =>
        wanted.toLowerCase() === language.toLowerCase() ||
        wanted.toLowerCase().startsWith(`${language.toLowerCase()}-`) ||
        wanted.toLowerCase().startsWith(`${language.toLowerCase()}_`),
    );
  for (const locale of SUPPORTED_LOCALES) {
    for (const language of locale === "en"
      ? ["en", "en-US", "en-GB"]
      : [locale, locale.replaceAll("-", "_")])
      assert.equal(keeps(language), true, language);
  }
  assert.equal(keeps("it"), false);
  assert.ok(config.files.includes("!node_modules/effect/src/**/*"));
  assert.ok(config.files.includes("node_modules/**/*"));
  assert.ok(config.asarUnpack.includes("node_modules/better-sqlite3/**/*"));
});

void test("packages and signs the locked computer use plug-in on macOS only", () => {
  const mac = parse(buildElectronBuilderConfig("branded", "mac"));
  assert.ok(
    mac.extraResources.some(
      (entry) =>
        entry.from === "resources/locked-computer-use" && entry.to === "locked-computer-use",
    ),
  );
  assert.deepEqual(mac.mac.binaries, [
    "Contents/Resources/locked-computer-use/PoracodeLockedUse.bundle",
  ]);
  for (const platform of ["win", "linux"]) {
    const config = parse(buildElectronBuilderConfig("branded", platform));
    assert.equal(
      config.extraResources.some((entry) => entry.from === "resources/locked-computer-use"),
      false,
    );
    assert.equal(config.mac.binaries, undefined);
  }
});

void test("macOS packaging requires the staged locked computer use plug-in", (t) => {
  const root = mkdtempSync(join(tmpdir(), "poracode-lcu-resources-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => verifyLockedComputerUseResources(root), /prepare-locked-computer-use/u);
  mkdirSync(join(root, "PoracodeLockedUse.bundle", "Contents", "MacOS"), { recursive: true });
  for (const file of [
    "PoracodeLockedUse.bundle/Contents/Info.plist",
    "PoracodeLockedUse.bundle/Contents/MacOS/PoracodeLockedUse",
    "locked-computer-use-installer",
    "README.md",
  ]) {
    writeFileSync(join(root, file), "x");
  }
  verifyLockedComputerUseResources(root);
});

void test("ViscosityCode packaging identity never names the upstream product or feed", () => {
  for (const platform of ["mac", "win", "linux"]) {
    for (const channel of ["stable", "nightly"]) {
      const config = withPackagingEnv(
        { PORACODE_CHANNEL: channel, VISCOSITYCODE_UPDATE_REPO: undefined },
        () => parse(buildElectronBuilderConfig("branded", platform)),
      );
      const nightly = channel === "nightly";
      assert.equal(
        config.appId,
        nightly ? "com.viscositycode.app.nightly" : "com.viscositycode.app",
      );
      assert.equal(config.productName, nightly ? "ViscosityCode Nightly" : "ViscosityCode");
      assert.equal(
        config.copyright,
        "Copyright (C) 2026 ViscosityCode contributors. Based on Poracode (Apache-2.0).",
      );
      assert.equal(config.publish, null, "no update feed without VISCOSITYCODE_UPDATE_REPO");
      assert.equal(
        config.linux.executableName,
        nightly ? "viscositycode-nightly-desktop" : "viscositycode-desktop",
      );
      assert.equal(config.linux.maintainer, "ViscosityCode contributors");
      assert.equal(config.mac.executableName, config.productName);
      assert.match(config.mac.extendInfo.NSMicrophoneUsageDescription, /^ViscosityCode/u);
      assert.match(
        config.nsis.artifactName,
        nightly ? /^ViscosityCode-Nightly-Setup-/u : /^ViscosityCode-Setup-/u,
      );
      const { copyright: _attribution, ...rest } = config;
      assert.doesNotMatch(JSON.stringify(rest), /Porabuild|poracode\.com|Lightcode/u);
    }
  }
  const updater = withPackagingEnv({ PORACODE_CHANNEL: "stable" }, () =>
    parse(buildElectronBuilderConfig("updater", "mac")),
  );
  assert.equal(updater.mac.executableName, "ViscosityCode");
});

void test("ad-hoc signs unsigned macOS builds as a whole", () => {
  const unsigned = {
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    CSC_LINK: undefined,
    CSC_NAME: undefined,
  };
  assert.equal(wantsMacAdhocSigning(unsigned), true);
  assert.equal(wantsMacAdhocSigning({ ...unsigned, CSC_LINK: "base64-p12" }), false);
  assert.equal(
    wantsMacAdhocSigning({ ...unsigned, CSC_NAME: "Developer ID Application: X" }),
    false,
  );
  assert.equal(wantsMacAdhocSigning({}), false, "default discovery keeps normal signing");
  const adhoc = withPackagingEnv(unsigned, () =>
    parse(buildElectronBuilderConfig("branded", "mac")),
  );
  assert.equal(adhoc.mac.identity, "-");
  const signed = withPackagingEnv({ ...unsigned, CSC_LINK: "base64-p12" }, () =>
    parse(buildElectronBuilderConfig("branded", "mac")),
  );
  assert.equal(signed.mac.identity, undefined);
});

void test("emits a GitHub update feed only for VISCOSITYCODE_UPDATE_REPO", () => {
  const stable = withPackagingEnv(
    { PORACODE_CHANNEL: "stable", VISCOSITYCODE_UPDATE_REPO: " acme/viscosity-code " },
    () => parse(buildElectronBuilderConfig("branded", "win")),
  );
  assert.deepEqual(stable.publish, { provider: "github", owner: "acme", repo: "viscosity-code" });
  const nightly = withPackagingEnv(
    { PORACODE_CHANNEL: "nightly", VISCOSITYCODE_UPDATE_REPO: "acme/viscosity-code" },
    () => parse(buildElectronBuilderConfig("branded", "mac")),
  );
  assert.deepEqual(nightly.publish, {
    provider: "github",
    owner: "acme",
    repo: "viscosity-code",
    channel: "nightly",
  });
  assert.equal(resolveUpdateRepository({}), undefined);
  assert.equal(resolveUpdateRepository({ VISCOSITYCODE_UPDATE_REPO: "  " }), undefined);
  for (const invalid of ["acme", "acme/", "/repo", "acme/repo/extra", "acme/..", "-acme/repo"]) {
    assert.throws(
      () => resolveUpdateRepository({ VISCOSITYCODE_UPDATE_REPO: invalid }),
      /VISCOSITYCODE_UPDATE_REPO must be "owner\/repo"/u,
    );
  }
});

void test("stages ViscosityCode package metadata without the upstream repository", (t) => {
  const root = mkdtempSync(join(tmpdir(), "desktop-stage-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of [...Object.keys(pkg.dependencies), "electron", "electron-builder"]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "package.json"), JSON.stringify({ version: "1.2.3" }));
  }
  const upstreamPkg = {
    ...pkg,
    repository: { type: "git", url: "https://github.com/Porabuild/Poracode" },
  };
  const stable = buildStagePackageJson(upstreamPkg, root, {});
  assert.equal(stable.productName, "ViscosityCode");
  assert.equal(stable.name, pkg.name, "the internal package name is unchanged");
  assert.equal(stable.repository, undefined);
  assert.equal(stable.homepage, "https://github.com/Porabuild/Poracode");
  const nightly = buildStagePackageJson(upstreamPkg, root, {
    PORACODE_CHANNEL: "nightly",
    VISCOSITYCODE_UPDATE_REPO: "acme/viscosity-code",
  });
  assert.equal(nightly.productName, "ViscosityCode Nightly");
  assert.deepEqual(nightly.repository, {
    type: "git",
    url: "https://github.com/acme/viscosity-code",
  });
  assert.equal(nightly.homepage, "https://github.com/acme/viscosity-code");
});

const AZURE_ENV = {
  AZURE_SIGNING_PUBLISHER_NAME: "ViscosityCode contributors",
  AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
  AZURE_SIGNING_ACCOUNT_NAME: "viscosity",
  AZURE_SIGNING_CERT_PROFILE: "public-trust",
};
const NO_AZURE_ENV = Object.fromEntries(Object.keys(AZURE_ENV).map((key) => [key, undefined]));

void test("Windows signing skips only the hash-checked PTY job owner", () => {
  const config = withPackagingEnv(NO_AZURE_ENV, () =>
    parse(buildElectronBuilderConfig("branded", "win")),
  );
  assert.deepEqual(config.win.signExts, ["!pty-job-owner-v1.exe"]);
  assert.equal(config.win.azureSignOptions, undefined);
  // The installed electron-builder's own filter decides what gets signed.
  const appBuilderRequire = createRequire(
    createRequire(import.meta.url).resolve("electron-builder"),
  );
  const { WinPackager } = appBuilderRequire("app-builder-lib");
  const shouldSign = (file) =>
    WinPackager.prototype.shouldSignFile.call({ platformSpecificBuildOptions: config.win }, file);
  assert.equal(shouldSign("resources/pty-job-owner/win32-x64/pty-job-owner-v1.exe"), false);
  assert.equal(shouldSign("resources/pty-job-owner/win32-arm64/pty-job-owner-v1.exe"), false);
  assert.equal(shouldSign("ViscosityCode.exe"), true);
  assert.equal(shouldSign("resources/computer-use-helper/win32-x64/helper.exe"), true);
});

void test("emits Azure Trusted Signing options only when fully configured", () => {
  const config = withPackagingEnv(AZURE_ENV, () =>
    parse(buildElectronBuilderConfig("branded", "win")),
  );
  assert.deepEqual(config.win.azureSignOptions, {
    publisherName: "ViscosityCode contributors",
    endpoint: "https://eus.codesigning.azure.net/",
    codeSigningAccountName: "viscosity",
    certificateProfileName: "public-trust",
  });
  assert.deepEqual(config.win.signExts, ["!pty-job-owner-v1.exe"]);
  // GitHub Actions passes absent secrets as empty strings.
  const blank = Object.fromEntries(Object.keys(AZURE_ENV).map((key) => [key, " "]));
  assert.equal(resolveAzureSignOptions(blank), undefined);
  assert.throws(
    () => resolveAzureSignOptions({ ...AZURE_ENV, AZURE_SIGNING_CERT_PROFILE: "" }),
    /partly configured; also set AZURE_SIGNING_CERT_PROFILE/u,
  );
  // A macOS build never reads the Windows signing settings.
  const mac = withPackagingEnv({ ...AZURE_ENV, AZURE_SIGNING_ENDPOINT: "" }, () =>
    parse(buildElectronBuilderConfig("branded", "mac")),
  );
  assert.equal(mac.win.azureSignOptions, undefined);
});

void test("rejects a packaged PTY job owner that signing rewrote", (t) => {
  const release = mkdtempSync(join(tmpdir(), "desktop-win-release-"));
  t.after(() => rmSync(release, { recursive: true, force: true }));
  // PE header fixture with the GUI subsystem; nothing is launched.
  const owner = (machine) => {
    const bytes = Buffer.alloc(512);
    bytes.writeUInt16LE(0x5a4d, 0);
    bytes.writeUInt32LE(64, 0x3c);
    bytes.writeUInt32LE(0x00004550, 64);
    bytes.writeUInt16LE(machine, 68);
    bytes.writeUInt16LE(240, 84);
    bytes.writeUInt16LE(0x20b, 88);
    bytes.writeUInt16LE(2, 156);
    return bytes;
  };
  const targets = {};
  const bytesFor = {};
  for (const [arch, machine] of [
    ["x64", 0x8664],
    ["arm64", 0xaa64],
  ]) {
    bytesFor[arch] = owner(machine);
    targets[`win32-${arch}`] = {
      relativePath: `win32-${arch}/pty-job-owner-v1.exe`,
      bytes: bytesFor[arch].length,
      sha256: createHash("sha256").update(bytesFor[arch]).digest("hex"),
    };
  }
  const manifest = JSON.stringify({
    formatVersion: 1,
    protocolVersion: 1,
    helperVersion: "1.0.0",
    sourceSha256: "a".repeat(64),
    targets,
  });
  // Every installer ships both owners plus the manifest.
  const ownerPath = (dir, arch) =>
    join(release, dir, "resources", "pty-job-owner", `win32-${arch}`, "pty-job-owner-v1.exe");
  for (const dir of ["win-unpacked", "win-arm64-unpacked"]) {
    for (const arch of ["x64", "arm64"]) {
      mkdirSync(join(ownerPath(dir, arch), ".."), { recursive: true });
      writeFileSync(ownerPath(dir, arch), bytesFor[arch]);
    }
    writeFileSync(join(release, dir, "resources", "pty-job-owner", "manifest.json"), manifest);
  }
  const files = { arm64: ownerPath("win-arm64-unpacked", "arm64") };

  verifyPackagedWinPtyOwners(release, ["x64", "arm64"]);
  // An Authenticode signature is appended to the PE file.
  appendFileSync(files.arm64, Buffer.alloc(16, 1));
  verifyPackagedWinPtyOwners(release, ["x64"]);
  assert.throws(
    () => verifyPackagedWinPtyOwners(release, ["x64", "arm64"]),
    /PTY job owner content or native GUI executable shape differs/u,
  );
  // The x64 installer also ships the arm64 owner, which the runtime checks too.
  appendFileSync(ownerPath("win-unpacked", "arm64"), Buffer.alloc(16, 1));
  assert.throws(
    () => verifyPackagedWinPtyOwners(release, ["x64"]),
    /PTY job owner content or native GUI executable shape differs/u,
  );
});

void test("rejects undeclared files next to the packaged PTY job owner", (t) => {
  const release = mkdtempSync(join(tmpdir(), "desktop-win-release-"));
  t.after(() => rmSync(release, { recursive: true, force: true }));
  const root = join(release, "win-unpacked", "resources", "pty-job-owner");
  const bytes = Buffer.alloc(512);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x00004550, 64);
  bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(240, 84);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt16LE(2, 156);
  mkdirSync(join(root, "win32-x64"), { recursive: true });
  writeFileSync(join(root, "win32-x64", "pty-job-owner-v1.exe"), bytes);
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      formatVersion: 1,
      protocolVersion: 1,
      helperVersion: "1.0.0",
      sourceSha256: "a".repeat(64),
      targets: {
        "win32-x64": {
          relativePath: "win32-x64/pty-job-owner-v1.exe",
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    }),
  );
  verifyPackagedWinPtyOwners(release, ["x64"]);
  writeFileSync(join(root, "win32-x64", "pty-job-owner-v1.exe.sig"), "x");
  assert.throws(() => verifyPackagedWinPtyOwners(release, ["x64"]), /undeclared or partial files/u);
});
