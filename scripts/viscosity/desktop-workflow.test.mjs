// ViscosityCode: guards the fork's desktop installer workflow (Tauri shell).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  await readFile(new URL("../../.github/workflows/viscosity-desktop.yml", import.meta.url), "utf8"),
);
const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
const tauri = workflow.jobs.tauri;
const step = (name) => tauri.steps.find((candidate) => candidate.name === name);

void test("builds Tauri DMGs for both Mac architectures and a Windows x64 NSIS installer", () => {
  const legs = Object.fromEntries(tauri.strategy.matrix.include.map((leg) => [leg.target, leg]));
  assert.deepEqual(Object.keys(legs).sort(), ["darwin-arm64", "darwin-x64", "win32-x64"]);
  assert.equal(legs["darwin-arm64"].bundles, "app,dmg");
  assert.equal(legs["darwin-x64"].bundles, "app,dmg");
  assert.equal(legs["win32-x64"].bundles, "nsis");
  assert.equal(workflow.env.TAURI_CLI, "@tauri-apps/cli@2.12.4");
  assert.match(
    step("Package").run,
    /npm install --prefix (\S+) .*"\$TAURI_CLI"\n\s*\1\/node_modules\/\.bin\/tauri build /u,
  );
  // npx inside the repo fails npm's override check (EOVERRIDE).
  assert.doesNotMatch(step("Package").run, /\bnpx\b/u);
  assert.match(step("Package").run, /--config tauri\.bundle\.conf\.json/u);
});

void test("no longer packages Electron", () => {
  const source = JSON.stringify(workflow);
  assert.doesNotMatch(source, /build-desktop-artifact|electron-builder|CSC_IDENTITY/u);
});

void test("bundles the qualified standalone archive for each leg's own target", () => {
  assert.equal(workflow.jobs.server.uses, "./.github/workflows/_server-artifact.yml");
  assert.deepEqual(tauri.needs, ["version", "server"]);
  const download = step("Download the standalone archive");
  assert.equal(download.with.pattern, "viscosity-server-standalone-${{ matrix.target }}-*");
  assert.match(step("Stage the standalone archive (macOS)").run, /checkLayout/u);
  assert.match(step("Stage the standalone archive (Windows)").run, /runtime\/node\.exe/u);
});

void test("the server archive build stages live_re before assembling the tarball", async () => {
  const server = parse(
    await readFile(
      new URL("../../.github/workflows/_server-artifact.yml", import.meta.url),
      "utf8",
    ),
  );
  const steps = server.jobs.build.steps;
  const script = steps.find(
    (candidate) => candidate.name === "Build and assemble the server artifact",
  ).run;
  const stage = script.indexOf("node scripts/prepare-live-re.mjs --require --host-only");
  assert.ok(stage > script.indexOf("prepare:git-helper"), "live_re must be staged with --require");
  assert.ok(stage < script.indexOf("assemble-server-tarball.mjs"), "stage live_re before assembly");
  assert.ok(steps.some((candidate) => candidate.with?.workspaces === "native/live-re"));
});

void test("a re-run of only the failed legs still finds the server job's archives", async () => {
  // "Re-run failed jobs" bumps run_attempt without re-running the server job.
  assert.doesNotMatch(JSON.stringify(tauri), /run_attempt/u);
  assert.ok(workflow.jobs.server.with.retention_days >= 3, "re-runs need the archives for days");
  const dir = await mkdtemp(join(tmpdir(), "viscosity-pick-"));
  try {
    const downloads = join(dir, "standalone");
    for (const attempt of [1, 2, 10])
      await mkdir(join(downloads, `viscosity-server-standalone-darwin-arm64-${attempt}`), {
        recursive: true,
      });
    const envFile = join(dir, "github-env");
    const picked = spawnSync("bash", ["-c", step("Pick the newest attempt's archive").run], {
      env: { ...process.env, DOWNLOAD_DIR: downloads, GITHUB_ENV: envFile },
      encoding: "utf8",
    });
    assert.equal(picked.status, 0, picked.stderr);
    assert.equal(
      await readFile(envFile, "utf8"),
      `ARCHIVE_DIR=${join(downloads, "viscosity-server-standalone-darwin-arm64-10")}\n`,
    );
    // A single matching artifact is extracted straight into the download path.
    const single = join(dir, "single");
    await mkdir(single, { recursive: true });
    await writeFile(join(single, "poracode-2.0.0-darwin-arm64.tar.gz"), "");
    const singleEnv = join(dir, "single-env");
    const pickedSingle = spawnSync("bash", ["-c", step("Pick the newest attempt's archive").run], {
      env: { ...process.env, DOWNLOAD_DIR: single, GITHUB_ENV: singleEnv },
      encoding: "utf8",
    });
    assert.equal(pickedSingle.status, 0, pickedSingle.stderr);
    assert.equal(await readFile(singleEnv, "utf8"), `ARCHIVE_DIR=${single}\n`);
    for (const name of [
      "Stage the standalone archive (macOS)",
      "Stage the standalone archive (Windows)",
    ])
      assert.equal(step(name).env?.ARCHIVE_DIR, undefined, `${name} must use the picked folder`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("draft release notes warn that Electron-created data folders are refused", () => {
  const create = workflow.jobs["draft-release"].steps[1].run;
  assert.match(create, /Electron/u);
  assert.match(create, /VISCOSITY_TAURI_BASE_DIR/u);
  assert.match(create, /SmartScreen/u);
  assert.match(create, /Node\.js JavaScript Runtime/u);
});

void test("uploads only installers under the fork's names, and releases only those", () => {
  const upload = step("Upload installers");
  assert.match(upload.with.path, /bundle\/dmg\/ViscosityCode_\*\.dmg/u);
  assert.match(upload.with.path, /bundle\/nsis\/ViscosityCode_\*-setup\.exe/u);
  assert.doesNotMatch(upload.with.path, /Poracode/u);
  for (const leg of tauri.strategy.matrix.include) assert.match(leg.artifact, /^viscositycode-/u);
  const download = workflow.jobs["draft-release"].steps[0];
  assert.equal(download.with.pattern, "viscositycode-*");
});

void test("signing secrets only reach the packaging step", () => {
  const secretSteps = allSteps.filter((candidate) =>
    /secrets\.(MAC_CSC|WIN_CSC|APPLE_|AZURE_)/u.test(JSON.stringify(candidate.env ?? {})),
  );
  assert.deepEqual(
    secretSteps.map((candidate) => candidate.name),
    ["Package"],
  );
  assert.equal(workflow.jobs.server.secrets, undefined, "the server build gets no secrets");
});

void test("run scripts never interpolate expressions directly", () => {
  for (const candidate of allSteps) {
    if (typeof candidate.run !== "string") continue;
    assert.doesNotMatch(
      candidate.run,
      /\$\{\{/u,
      `step "${candidate.name ?? candidate.run}" inlines an expression`,
    );
  }
});

void test("ships no telemetry keys", () => {
  assert.equal(workflow.env.POSTHOG_ENABLED, "0");
  assert.doesNotMatch(JSON.stringify(workflow), /POSTHOG_KEY|SENTRY_DSN|SENTRY_AUTH_TOKEN/u);
});
