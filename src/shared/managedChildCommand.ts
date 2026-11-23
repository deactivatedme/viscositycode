import { spawn, type ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { terminateChildProcessTree } from "./processTree";

/** Custody for fixed vendor setup commands. Output is private and bounded; never logged. */
export interface ManagedChildCommand {
  done: Promise<string>;
  cancel(): Promise<void>;
}
export function startManagedChildCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    onOutput?: (output: string) => void;
    captureOutput?: boolean;
  },
): ManagedChildCommand {
  const ownedProcessGroup = process.platform !== "win32";
  const child: ChildProcess = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: ownedProcessGroup,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  let stopped = false;
  let output = "";
  let stdout = "";
  let problem: Error | undefined;
  const stop = () => {
    stopped = true;
    if (child.exitCode === null && child.signalCode === null)
      terminateChildProcessTree(child, { ownedProcessGroup });
  };
  const timer =
    options.timeoutMs > 0
      ? setTimeout(() => {
          problem = new Error("The setup operation timed out.");
          stop();
        }, options.timeoutMs).unref()
      : undefined;
  const done = new Promise<string>((resolve, reject) => {
    const collect = (chunk: Buffer, isStdout: boolean) => {
      if (options.captureOutput === false) return;
      if (output.length + chunk.length > 64 * 1024) {
        problem = new Error("The setup operation produced too much output.");
        stop();
        return;
      }
      const text = chunk.toString("utf8");
      output += text;
      if (isStdout) stdout += text;
      options.onOutput?.(output);
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
    child.once("error", (error) => {
      problem = new Error(`${basename(command)} could not start.`, { cause: error });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (problem) reject(problem);
      else if (stopped) reject(new Error("The setup operation was cancelled."));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${basename(command)} exited with code ${code ?? "unknown"}.`));
    });
  });
  // Setup flows may publish a URL before their final result is awaited.
  void done.catch(() => undefined);
  return {
    done,
    async cancel() {
      stop();
      await done.catch(() => undefined);
    },
  };
}
