// ViscosityCode: the live_re helper contract (versions mirrored in Rust, the --environment report).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIVE_RE_ENVIRONMENT_VERSION,
  LIVE_RE_PROTOCOL_ENV,
  LIVE_RE_PROTOCOL_VERSION,
  readLiveReEnvironment,
} from "./liveRe";

const V1_REPORT = {
  environmentVersion: 1,
  helperVersion: "0.1.0",
  protocolVersion: 1,
  host: { os: "macos", arch: "aarch64" },
  tools: [
    {
      status: "found",
      path: "/Library/Developer/CommandLineTools/usr/bin/lldb-dap",
      version: "LLVM version 21.0.0",
      id: "lldb-dap",
    },
    { status: "missing", id: "adb" },
  ],
  sip: "enabled",
  devToolsSecurity: "disabled",
  targets: {
    macosApps: { state: "limited", reason: "sip-enabled" },
    iosSimulator: { state: "unavailable", reason: "no-xcode" },
    iosDevice: { state: "unavailable", reason: "no-xcode" },
    android: { state: "unavailable", reason: "no-adb" },
    windows: { state: "unavailable", reason: "other-os" },
  },
};

describe("live_re contract", () => {
  it("mirrors the Rust helper's version constants", () => {
    const rust = readFileSync(resolve(__dirname, "../../../native/live-re/src/version.rs"), "utf8");
    expect(rust).toContain(`pub const TOOLS_PROTOCOL_VERSION: u64 = ${LIVE_RE_PROTOCOL_VERSION};`);
    expect(rust).toContain(`pub const ENVIRONMENT_VERSION: u64 = ${LIVE_RE_ENVIRONMENT_VERSION};`);
    expect(rust).toContain(`pub const PROTOCOL_ENV: &str = "${LIVE_RE_PROTOCOL_ENV}";`);
  });

  it("reads a v1 report and drops unknown fields", () => {
    const read = readLiveReEnvironment({ ...V1_REPORT, extra: "dropped" });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.environment.targets.macosApps).toEqual({ state: "limited", reason: "sip-enabled" });
    expect(read.environment).not.toHaveProperty("extra");
  });

  it("asks for an update on another environment or tool protocol version", () => {
    expect(readLiveReEnvironment({ ...V1_REPORT, environmentVersion: 2 }).status).toBe(
      "update-needed",
    );
    expect(readLiveReEnvironment({ environmentVersion: 2 }).status).toBe("update-needed");
    expect(readLiveReEnvironment({ ...V1_REPORT, protocolVersion: 2 }).status).toBe(
      "update-needed",
    );
  });

  it("rejects malformed reports", () => {
    expect(readLiveReEnvironment(null).status).toBe("malformed");
    expect(readLiveReEnvironment([V1_REPORT]).status).toBe("malformed");
    expect(readLiveReEnvironment({ ...V1_REPORT, environmentVersion: "1" }).status).toBe(
      "malformed",
    );
    expect(readLiveReEnvironment({ ...V1_REPORT, sip: "maybe" }).status).toBe("malformed");
    const badReason = {
      ...V1_REPORT,
      targets: { ...V1_REPORT.targets, android: { state: "ready", reason: "<b>x</b>" } },
    };
    expect(readLiveReEnvironment(badReason).status).toBe("malformed");
  });
});
