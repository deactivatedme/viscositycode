import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
const workflow = parse(
  readFileSync(
    new URL("../../.github/workflows/viscosity-windows-fallback.yml", import.meta.url),
    "utf8",
  ),
);
test("Windows fallback qualifies its own server and archive before packaging", () => {
  assert.deepEqual(
    workflow.jobs.build.strategy.matrix.include.map(({ name }) => name),
    ["windows"],
  );
  assert.deepEqual(
    workflow.jobs.standalone.strategy.matrix.include.map(({ target }) => target),
    ["win32-x64"],
  );
  assert.deepEqual(
    workflow.jobs.tauri.strategy.matrix.include.map(({ target }) => target),
    ["win32-x64"],
  );
  assert.deepEqual(workflow.jobs.tauri.needs, ["version", "standalone"]);
  assert.ok(
    workflow.jobs.build.steps.some(({ run }) => run?.includes("server-install-qualification.mjs")),
  );
  assert.ok(
    workflow.jobs.standalone.steps.some(({ run }) => run?.includes("installer-qualification.mjs")),
  );
  assert.equal(
    workflow.jobs.tauri.steps.find(({ name }) => name === "Download the standalone archive").with
      .pattern,
    "${{ inputs.artifact_name }}-standalone-${{ matrix.target }}-*",
  );
  assert.equal(workflow.jobs["draft-release"], undefined);
});
