// ViscosityCode: the live_re helper spec on the shared native-helper driver.
// Nothing here runs cargo: hello validation, the Linux no-op, and --require
// without Rust (PATH stripped) with and without the allow-missing flag.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { skipsLinux, spec } from "./prepare-live-re.mjs";

const script = fileURLToPath(new URL("./prepare-live-re.mjs", import.meta.url));
const emptyPath = mkdtempSync(join(tmpdir(), "prepare-live-re-path-"));
after(() => rmSync(emptyPath, { recursive: true, force: true }));

function runWithoutRust(args, extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      PATH: emptyPath,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...extraEnv,
    },
  });
}

void describe("prepare-live-re", () => {
  void it("reads the protocol version from the shared contract", () => {
    assert.equal(spec.expectedVersion(), 1);
    assert.deepEqual(
      spec.targetTable.win.map((target) => target.id),
      ["win32-x64", "win32-arm64"],
    );
  });

  void it("accepts the current hello and rejects stale or foreign ones", () => {
    const hello = {
      helper: "viscosity-live-re",
      helperVersion: "0.1.0",
      protocolVersion: 1,
      mcpProtocolVersions: ["2025-06-18"],
      platform: "win32",
      arch: "arm64",
    };
    assert.doesNotThrow(() => spec.validateHello(hello, "live-re.exe", 1));
    assert.throws(
      () => spec.validateHello({ ...hello, protocolVersion: 2 }, "x", 1),
      /incompatible/u,
    );
    assert.throws(() => spec.validateHello({ ...hello, platform: "linux" }, "x", 1), /invalid/u);
    assert.throws(() => spec.validateHello({ ...hello, helper: "poracode-git-helper" }, "x", 1));
    assert.throws(() => spec.verifyManifest({ protocolVersion: 1, clientProtocolVersion: 0 }, 1));
  });

  void it("treats Linux as a no-op, even with --require", () => {
    assert.equal(skipsLinux(["--platform", "linux", "--require"], "mac"), true);
    assert.equal(skipsLinux(["--require"], "linux"), true);
    assert.equal(skipsLinux(["--platform", "win32"], "win"), false);
    assert.equal(skipsLinux(["--host-only"], "mac"), false);
    const result = runWithoutRust(["--platform", "linux", "--require"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no live_re build for Linux/u);
  });

  void it(
    "fails --require without Rust unless PORACODE_ALLOW_MISSING_LIVE_RE is set",
    { skip: process.platform === "linux" && "Linux has no live_re target" },
    () => {
      const strict = runWithoutRust(["--require", "--host-only"]);
      assert.equal(strict.status, 1);
      assert.match(strict.stderr, /cargo\/rustup is unavailable/u);
      const allowed = runWithoutRust(["--require", "--host-only"], {
        PORACODE_ALLOW_MISSING_LIVE_RE: "1",
      });
      assert.equal(allowed.status, 0, allowed.stderr);
      const devLaunch = runWithoutRust(["--host-only"]);
      assert.equal(devLaunch.status, 0, devLaunch.stderr);
    },
  );
});

// The fork works on `main`; CI must build and run the Windows/macOS helper
// there before a release does. Plain text: the live_re job has no node_modules.
void it("runs the live_re CI job on pushes and PRs to main for every desktop OS", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const triggers = ci.slice(ci.indexOf("\non:"), ci.indexOf("\njobs:"));
  assert.match(triggers, /pull_request:\n\s+branches: \[main,/u);
  assert.match(triggers, /push:\n\s+branches: \[main,/u);
  const job = ci.slice(ci.indexOf("\n  live_re:"), ci.indexOf("\n  test_shard:"));
  assert.match(job, /os: \[ubuntu-latest, windows-latest, macos-latest\]/u);
  assert.match(job, /prepare-live-re\.mjs --platform "\$platform" --require/u);
  assert.match(job, /prepare-live-re\.mjs --platform "\$platform" --check/u);
  assert.match(ci, /"git_helper", "live_re"/u);
});
