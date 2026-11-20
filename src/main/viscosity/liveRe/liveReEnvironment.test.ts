// ViscosityCode: the desktop live_re setup probe (bounded, read-only, versioned).
import { describe, expect, it, vi } from "vitest";
import { liveReBinaryPath } from "@/shared/viscosity/liveReBinary";
import { createLiveReEnvironmentProbe, type LiveReExecFile } from "./liveReEnvironment";

const REPORT = {
  environmentVersion: 1,
  helperVersion: "0.1.0",
  protocolVersion: 1,
  host: { os: "windows", arch: "x86_64" },
  tools: [{ id: "lldb-dap", status: "missing" }],
  sip: "not-applicable",
  devToolsSecurity: "not-applicable",
  targets: {
    macosApps: { state: "unavailable", reason: "other-os" },
    iosSimulator: { state: "unavailable", reason: "other-os" },
    iosDevice: { state: "unavailable", reason: "other-os" },
    android: { state: "unavailable", reason: "no-adb" },
    windows: { state: "unavailable", reason: "no-debugger" },
  },
};

function fakeExec(error: object | null, stdout = ""): LiveReExecFile & ReturnType<typeof vi.fn> {
  return vi.fn<LiveReExecFile>((_file, _args, _options, callback) => {
    callback(error ? Object.assign(new Error("exec"), error) : null, stdout);
  }) as never;
}

const probeWith = (execFile: LiveReExecFile, binary: string | null = "C:\\live-re.exe") =>
  createLiveReEnvironmentProbe({ binaryPath: () => binary ?? undefined, execFile });

describe("createLiveReEnvironmentProbe", () => {
  it("reports a build without the helper as missing, running nothing", async () => {
    const exec = fakeExec(null, "{}");
    expect(await probeWith(exec, null)()).toEqual({ status: "missing" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("runs --environment with the timeout, output cap and no console window", async () => {
    const exec = fakeExec(null, JSON.stringify(REPORT));
    const reply = await probeWith(exec)();
    expect(reply.status).toBe("ok");
    expect(exec).toHaveBeenCalledWith(
      "C:\\live-re.exe",
      ["--environment"],
      { timeout: 10_000, maxBuffer: 65_536, windowsHide: true, encoding: "utf8" },
      expect.any(Function),
    );
  });

  it("maps timeouts, oversize output, failures and bad JSON to error codes", async () => {
    expect(await probeWith(fakeExec({ killed: true, signal: "SIGTERM" }))()).toEqual({
      status: "error",
      code: "timeout",
    });
    expect(
      await probeWith(fakeExec({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }))(),
    ).toEqual({ status: "error", code: "too-large" });
    expect(await probeWith(fakeExec({ code: 2 }))()).toEqual({ status: "error", code: "failed" });
    expect(await probeWith(fakeExec(null, "not json"))()).toEqual({
      status: "error",
      code: "malformed",
    });
    const throwing = vi.fn<LiveReExecFile>(() => {
      throw new Error("spawn EACCES");
    });
    expect(await probeWith(throwing)()).toEqual({ status: "error", code: "failed" });
  });

  it("asks for an update when the helper reports another version", async () => {
    const exec = fakeExec(null, JSON.stringify({ ...REPORT, environmentVersion: 2 }));
    expect(await probeWith(exec)()).toEqual({ status: "update-needed" });
  });

  it("shares one probe between overlapping calls", async () => {
    let finish: (() => void) | undefined;
    const exec = vi.fn<LiveReExecFile>((_file, _args, _options, callback) => {
      finish = () => callback(null, JSON.stringify(REPORT));
    });
    const probe = probeWith(exec);
    const first = probe();
    const second = probe();
    finish?.();
    expect(await first).toEqual(await second);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  const staged = liveReBinaryPath();
  it.skipIf(!staged)("reads the real staged helper's report", async () => {
    const reply = await createLiveReEnvironmentProbe({ binaryPath: () => staged })();
    expect(reply.status).toBe("ok");
  });
});
