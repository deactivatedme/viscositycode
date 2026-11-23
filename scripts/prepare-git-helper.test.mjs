import assert from "node:assert/strict";
import { it } from "node:test";
import { spec } from "./prepare-git-helper.mjs";

void it("rejects the previous deployed v3 helper before staging the v4 tree client", () => {
  const previous = {
    helper: "poracode-git-helper",
    helperVersion: "0.3.0",
    protocolVersion: 3,
    platform: "win32",
    arch: "x64",
  };
  const expected = spec.expectedVersion();
  assert.equal(expected, 4);
  assert.throws(() => spec.validateHello(previous, "old-helper.exe", expected), /incompatible/u);
  for (const helperVersion of ["0.4.0", "0.4.1", "0.4.2"]) {
    assert.doesNotThrow(() =>
      spec.validateHello(
        { ...previous, helperVersion, protocolVersion: 4 },
        "current-helper.exe",
        expected,
      ),
    );
  }
});

void it("does not reuse a previous helper version's staged manifest", () => {
  const hello = {
    helper: "poracode-git-helper",
    helperVersion: "0.4.2",
    protocolVersion: 4,
    platform: "darwin",
    arch: "arm64",
  };
  const current = spec.manifestFields(hello, spec.expectedVersion());
  assert.equal(spec.manifestMatchesHello(current, hello), true);
  assert.equal(spec.manifestMatchesHello({ ...current, helperVersion: "0.4.1" }, hello), false);
});
