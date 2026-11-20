#!/usr/bin/env node

// ViscosityCode: stages the live reversing MCP server (native/live-re) into
// resources/wsl-helpers/live-re/<target>/ for darwin-universal, win32-x64 and
// win32-arm64. Linux hosts have no target: live_re is simply absent there.
// The shared driver lives in scripts/lib/native-helper-prepare.mjs; this file
// is only the helper's spec.

import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NATIVE_HELPER_TARGETS,
  hostPlatform,
  isMain,
  normalizePlatform,
  parseArgs,
  runScript,
} from "./lib/native-helper-prepare.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(repoRoot, "src", "shared", "viscosity", "liveRe.ts");

function liveReProtocolVersion() {
  const source = readFileSync(contractPath, "utf8");
  const match = /export const LIVE_RE_PROTOCOL_VERSION = (\d+);/u.exec(source);
  if (!match) {
    throw new Error(`Could not read the live_re protocol version from ${contractPath}`);
  }
  return Number(match[1]);
}

const expectedProtocolVersion = liveReProtocolVersion();

export const spec = {
  scriptName: "prepare-live-re",
  noun: "live-re",
  label: "Live reversing helper",
  helloNoun: "Live reversing helper",
  binaryName: "viscosity-live-re",
  crateRoot: join(repoRoot, "native", "live-re"),
  repoRoot,
  // macOS is always one universal binary, so only Windows needs table rows.
  targetTable: { win: NATIVE_HELPER_TARGETS.win },
  cargoProfile: () => "release",
  resourcesRoot: () => join(repoRoot, "resources", "wsl-helpers", "live-re"),
  missingToolMessage: () =>
    "Rust cargo/rustup is unavailable; the live_re debugging server will not be available",
  // Same PORACODE_ALLOW_MISSING_* family as the sibling helpers, so one
  // no-Rust packaging line covers all of them.
  allowMissing: () => /^(1|true|yes)$/i.test(process.env.PORACODE_ALLOW_MISSING_LIVE_RE ?? ""),
  expectedVersion: () => expectedProtocolVersion,
  // A Windows host with an unsupported arch warns and exits 0 for --host-only.
  unsupportedHostArch: "warn",
  validateHello(parsed, path, expectedVersion) {
    if (
      parsed?.helper !== "viscosity-live-re" ||
      typeof parsed?.helperVersion !== "string" ||
      parsed.helperVersion.length === 0 ||
      parsed?.protocolVersion !== expectedVersion ||
      !["darwin", "win32"].includes(parsed?.platform) ||
      !["x64", "arm64"].includes(parsed?.arch)
    ) {
      throw new Error(
        `Live reversing helper returned an invalid or incompatible --hello payload (expected protocol version ${expectedVersion}): ${path}`,
      );
    }
  },
  manifestFields: (hello, expectedVersion) => ({
    helper: hello.helper,
    helperVersion: hello.helperVersion,
    protocolVersion: hello.protocolVersion,
    clientProtocolVersion: expectedVersion,
  }),
  verifyManifest(manifest, expectedVersion) {
    if (
      manifest.protocolVersion !== expectedVersion ||
      manifest.clientProtocolVersion !== expectedVersion
    ) {
      throw new Error(
        `Live reversing helper manifest is incompatible with protocol version ${expectedVersion}`,
      );
    }
  },
  manifestMatchesHello: (manifest, hello) => manifest.helperVersion === hello.helperVersion,
};

/**
 * True when the requested platform is Linux: there is no live_re build for
 * it, so even --require succeeds with a warning (Linux packages and the
 * server tarball simply ship without it).
 */
export function skipsLinux(argv = process.argv.slice(2), host = hostPlatform()) {
  return normalizePlatform(parseArgs(argv).platform ?? host) === "linux";
}

if (isMain(import.meta.url)) {
  if (skipsLinux()) {
    console.warn("[prepare-live-re] no live_re build for Linux; skipping");
  } else {
    runScript(spec);
  }
}
