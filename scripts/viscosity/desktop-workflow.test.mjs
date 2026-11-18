// ViscosityCode: guards the fork's desktop installer workflow.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const channelTable = require("../electron-builder.shared.cjs");

const workflow = parse(
  await readFile(new URL("../../.github/workflows/viscosity-desktop.yml", import.meta.url), "utf8"),
);
const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);

void test("builds macOS DMGs and Windows NSIS installers for both architectures", () => {
  const legs = workflow.jobs.build.strategy.matrix.include;
  const byPlatform = Object.fromEntries(legs.map((leg) => [leg.platform, leg]));
  assert.equal(byPlatform.mac.target, "dmg");
  assert.equal(byPlatform.win.target, "nsis");
  assert.match(byPlatform.mac["rust-targets"], /aarch64-apple-darwin/u);
  assert.match(byPlatform.mac["rust-targets"], /x86_64-apple-darwin/u);
  assert.match(byPlatform.win["rust-targets"], /aarch64-pc-windows-msvc/u);
  assert.match(byPlatform.win["rust-targets"], /x86_64-pc-windows-msvc/u);
  assert.deepEqual(workflow.jobs.build.needs, "wsl-relay");
});

void test("uploads installers under the fork's artifact names", () => {
  const upload = workflow.jobs.build.steps.find((step) => step.name === "Upload installers");
  for (const channel of channelTable.CHANNELS) {
    const prefix = channelTable.artifactPrefixFor(channel);
    assert.ok(prefix.startsWith("ViscosityCode"), `${channel} prefix ${prefix}`);
  }
  assert.match(upload.with.path, /release\/ViscosityCode\*\.dmg/u);
  assert.match(upload.with.path, /release\/ViscosityCode\*\.exe/u);
  assert.doesNotMatch(upload.with.path, /Poracode/u);
});

void test("signing secrets only reach the packaging step", () => {
  const secretSteps = allSteps.filter((step) =>
    /secrets\.(MAC_CSC|WIN_CSC|APPLE_ID|APPLE_APP_SPECIFIC)/u.test(JSON.stringify(step.env ?? {})),
  );
  assert.deepEqual(
    secretSteps.map((step) => step.name),
    ["Package"],
  );
});

void test("run scripts never interpolate expressions directly", () => {
  for (const step of allSteps) {
    if (typeof step.run !== "string") continue;
    assert.doesNotMatch(
      step.run,
      /\$\{\{/u,
      `step "${step.name ?? step.run}" inlines an expression`,
    );
  }
});

void test("ships no telemetry keys", () => {
  assert.equal(workflow.env.POSTHOG_ENABLED, "0");
  assert.doesNotMatch(JSON.stringify(workflow), /POSTHOG_KEY|SENTRY_DSN|SENTRY_AUTH_TOKEN/u);
});
