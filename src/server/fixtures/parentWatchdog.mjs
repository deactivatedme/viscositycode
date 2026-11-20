import { HostOwnerLease } from "../../backend/ownership/hostOwnerLease.ts";
import { resolveHostRootPaths } from "../../backend/ownership/hostRootPaths.ts";
import { installShutdown } from "../cliRuntime.ts";
import { watchParentPid } from "../parentWatchdog.ts";

// Owned child wired exactly like `serve`: a real profile lease released by the
// shutdown drain, a retained interval, and the parent-pid watchdog requesting
// that same drain.
const [profile] = process.argv.slice(2);
const lease = HostOwnerLease.acquire(resolveHostRootPaths(profile), "headless");
const interval = setInterval(() => undefined, 250);
const control = installShutdown("[parent-watchdog-fixture]", async () => {
  clearInterval(interval);
  lease.release();
});
watchParentPid(process.env, (pid) => control.requestShutdown(`parent process ${pid} exit`));
process.send?.({ type: "ready" });
