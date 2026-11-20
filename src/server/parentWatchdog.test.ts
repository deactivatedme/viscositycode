import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostOwnerLease } from "@/backend/ownership/hostOwnerLease";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { expectOwned, stopOwnedChild, withinDeadline } from "./cliTestHelpers";
import { PARENT_PID_ENV, watchParentPid } from "./parentWatchdog";

afterEach(() => {
  vi.useRealTimers();
});

describe("watchParentPid", () => {
  it.each([undefined, "", "abc", "12x", "-5", "0", "1", "1.5", String(process.pid)])(
    "ignores %j",
    (value) => {
      vi.useFakeTimers();
      const isAlive = vi.fn<(pid: number) => boolean>(() => false);
      const onExit = vi.fn<(pid: number) => void>();
      const env = value === undefined ? {} : { [PARENT_PID_ENV]: value };
      watchParentPid(env, onExit, { isAlive });
      vi.advanceTimersByTime(10_000);
      expect(isAlive).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
    },
  );

  it("fires once after the parent dies and not after stop", () => {
    vi.useFakeTimers();
    let alive = true;
    const onExit = vi.fn<(pid: number) => void>();
    watchParentPid({ [PARENT_PID_ENV]: " 4242 " }, onExit, { isAlive: () => alive });
    vi.advanceTimersByTime(5_000);
    expect(onExit).not.toHaveBeenCalled();
    alive = false;
    vi.advanceTimersByTime(1_000);
    expect(onExit).toHaveBeenCalledExactlyOnceWith(4242);
    vi.advanceTimersByTime(5_000);
    expect(onExit).toHaveBeenCalledOnce();

    const stopped = vi.fn<(pid: number) => void>();
    const stop = watchParentPid({ [PARENT_PID_ENV]: "4243" }, stopped, { isAlive: () => false });
    stop();
    vi.advanceTimersByTime(5_000);
    expect(stopped).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === "win32")("serve parent-pid watchdog", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("drains and releases the owner lease within ~2 s of the parent dying", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poracode-parent-watchdog-"));
    directories.push(directory);
    const profile = join(directory, "profile");
    const parent = spawn("sleep", ["60"], { stdio: "ignore" });
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      [PARENT_PID_ENV]: String(parent.pid),
      NODE_PATH: fileURLToPath(new URL("../../node_modules/", import.meta.url)),
    };
    delete environment.NODE_OPTIONS;
    const child = fork(
      fileURLToPath(new URL("./fixtures/parentWatchdog.mjs", import.meta.url)),
      [profile],
      {
        execArgv: [
          "--disable-warning=ExperimentalWarning",
          "--import",
          new URL("../../scripts/remote-v3-ts-register.mjs", import.meta.url).href,
        ],
        env: environment,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const exited = once(child, "exit");
    try {
      await withinDeadline(once(child, "message"), "Fixture did not report ready.", 10_000);
      expectOwned(profile);
      const killedAt = Date.now();
      parent.kill("SIGKILL");
      const [code, signal] = await withinDeadline(exited, "Fixture outlived its parent.", 5_000);
      expect({ code, signal }).toEqual({ code: 0, signal: null });
      expect(Date.now() - killedAt).toBeLessThan(2_500);
      HostOwnerLease.acquire(resolveHostRootPaths(profile), "desktop").release();
    } finally {
      parent.kill("SIGKILL");
      await stopOwnedChild({ child, closed }, 5_000);
    }
  });
});
