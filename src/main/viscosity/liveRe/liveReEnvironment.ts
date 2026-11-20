/**
 * ViscosityCode: runs `viscosity-live-re --environment` for the desktop setup
 * check. Free of Electron imports so it can be tested with fakes. The helper
 * only reads (xcode-select -p before xcrun, csrutil, DevToolsSecurity -status,
 * lldb-dap --version, adb version); nothing here installs or changes anything.
 */
import { execFile } from "node:child_process";
import {
  readLiveReEnvironment,
  type LiveReEnvironmentReply,
  type LiveReProbeErrorCode,
} from "@/shared/viscosity/liveRe";
import { LIVE_RE_PROBE_MAX_BYTES, LIVE_RE_PROBE_TIMEOUT_MS } from "./liveReContract";

type ExecFileCallback = (
  error: (Error & { code?: unknown; killed?: boolean; signal?: unknown }) | null,
  stdout: string,
) => void;
export type LiveReExecFile = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide: true; encoding: "utf8" },
  callback: ExecFileCallback,
) => unknown;

export interface LiveReProbeOptions {
  binaryPath: () => string | undefined;
  execFile?: LiveReExecFile;
  timeoutMs?: number;
  maxBytes?: number;
}

function fail(code: LiveReProbeErrorCode): LiveReEnvironmentReply {
  return { status: "error", code };
}

/** One probe per call; callers that overlap share the probe in flight. */
export function createLiveReEnvironmentProbe(
  options: LiveReProbeOptions,
): () => Promise<LiveReEnvironmentReply> {
  const run = options.execFile ?? (execFile as unknown as LiveReExecFile);
  let inflight: Promise<LiveReEnvironmentReply> | null = null;
  const probe = (): Promise<LiveReEnvironmentReply> => {
    const binary = options.binaryPath();
    if (!binary) return Promise.resolve({ status: "missing" });
    return new Promise((resolve) => {
      try {
        run(
          binary,
          ["--environment"],
          {
            timeout: options.timeoutMs ?? LIVE_RE_PROBE_TIMEOUT_MS,
            maxBuffer: options.maxBytes ?? LIVE_RE_PROBE_MAX_BYTES,
            windowsHide: true,
            encoding: "utf8",
          },
          (error, stdout) => {
            if (error) {
              if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
                return resolve(fail("too-large"));
              if (error.killed === true || error.signal) return resolve(fail("timeout"));
              return resolve(fail("failed"));
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(stdout);
            } catch {
              return resolve(fail("malformed"));
            }
            const read = readLiveReEnvironment(parsed);
            if (read.status === "ok")
              return resolve({ status: "ok", environment: read.environment });
            return resolve(
              read.status === "update-needed" ? { status: "update-needed" } : fail("malformed"),
            );
          },
        );
      } catch {
        resolve(fail("failed"));
      }
    });
  };
  return () => {
    inflight ??= probe().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}
