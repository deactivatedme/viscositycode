// ViscosityCode: fork-only. Which project the shell's New session opens in.
import type { Thread } from "@/shared/contracts";
import { isHomeProjectId } from "@/shared/homeScope";
import { resolveNewThreadProjectId } from "@/renderer/actions/threadActions";

/**
 * The project of the most recently updated non-archived thread (Home threads
 * only while Home scope is on), checked by upstream's resolver, which falls back
 * to its own order.
 */
export function resolveNewSessionProjectId(
  state: { threads: readonly Thread[] },
  homeScopeEnabled: boolean,
): string | undefined {
  let latest: Thread | undefined;
  for (const thread of state.threads) {
    if (thread.archived) continue;
    // Old Home threads must not reopen a scope the user turned off.
    if (!homeScopeEnabled && isHomeProjectId(thread.projectId)) continue;
    if (!latest || thread.updatedAt > latest.updatedAt) latest = thread;
  }
  return resolveNewThreadProjectId(latest?.projectId);
}
