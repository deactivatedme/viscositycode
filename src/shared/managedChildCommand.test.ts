import { expect, it } from "vitest";
import { startManagedChildCommand } from "./managedChildCommand";

it("captures a fixed command and joins cancellation without exposing its output in failures", async () => {
  const success = startManagedChildCommand(
    process.execPath,
    ["-e", "process.stdout.write('fixture result')"],
    { timeoutMs: 2000 },
  );
  await expect(success.done).resolves.toBe("fixture result");
  await success.cancel();
  const failure = startManagedChildCommand(
    process.execPath,
    ["-e", "process.stderr.write('private-fixture-value');process.exit(7)"],
    { timeoutMs: 2000 },
  );
  await expect(failure.done).rejects.toThrow("exited with code 7");
  const pending = startManagedChildCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    timeoutMs: 2000,
  });
  await pending.cancel();
  await expect(pending.done).rejects.toThrow("cancelled");
});
