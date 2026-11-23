import { randomUUID } from "node:crypto";
import type { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import { ProviderFailure, type RunProvider } from "./providerTransport";

/** Credentials never leave the native supervisor. Cancellation joins its run. */
export function createSubscriptionRunner(
  supervisor: Pick<SupervisorClient, "callCodeShare">,
  readKey?: () => string,
): RunProvider {
  return async ({ model, messages, signal, append, remoteTools }) => {
    signal.throwIfAborted();
    const id = randomUUID();
    let cancellation: Promise<unknown> | undefined;
    const cancel = () => {
      cancellation ??= supervisor.callCodeShare({ action: "cancel", id }).catch(() => undefined);
    };
    // Queue run before cancel on the same IPC channel, even on immediate abort.
    const run = supervisor.callCodeShare<{ reply: string }>({
      action: readKey ? "key-run" : "run",
      ...(readKey ? { key: readKey() } : {}),
      id,
      model: model.id,
      messages,
      ...(remoteTools ? { remoteTools } : {}),
    });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result = await run;
      signal.throwIfAborted();
      append(result.reply);
      return null; // Native subscription runtimes do not return authoritative token counts here.
    } catch {
      throw new ProviderFailure("provider_unavailable");
    } finally {
      signal.removeEventListener("abort", cancel);
      await cancellation;
    }
  };
}
