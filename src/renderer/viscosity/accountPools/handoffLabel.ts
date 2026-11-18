/**
 * ViscosityCode: how a provider_handoff divider reads when the thread moved
 * because its account ran out of usage (fork of Poracode).
 *
 * The host fails a pooled thread over with the ordinary in-place provider
 * switch, so the transcript shows the usual `provider_handoff` divider right
 * after the failed turn's `usage_limited` error. A divider preceded (within
 * that turn) by such an error, or one whose own payload carries that reason,
 * reads "Switched to <account> because <previous> ran out of usage"; every
 * other divider keeps the existing "Switched from … to …" text.
 */
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import type { ErrorItemPayload } from "@/shared/contracts";
import { getRuntimeItemPayload } from "@/shared/runtimeItemVisibility";
import { useAppStore } from "@/renderer/state/appStore";

/** The runtime error reason an out-of-usage turn ends with (`RuntimeErrorReason`). */
export const USAGE_LIMITED_REASON = "usage_limited";

type AppState = ReturnType<typeof useAppStore.getState>;

/** True when a handoff payload itself says the previous account ran out (future hosts). */
export function isUsageLimitedHandoffPayload(payload: object): boolean {
  return (payload as { reason?: unknown }).reason === USAGE_LIMITED_REASON;
}

/**
 * Per transcript (keyed by the thread's item-id array, which streaming never
 * replaces) the dividers already classified at one structural version.
 * `runtimeStructuralVersionByThread` bumps on every item add, removal or
 * payload change but not on `content.delta`, so a streaming delta finds the
 * answer here in O(1) instead of walking the transcript again. Entries go
 * away with the array they are keyed by.
 */
const handoffScans = new WeakMap<
  readonly string[],
  { version: number | undefined; results: Map<string, boolean> }
>();

function scanHandoffFollowsUsageLimit(
  ids: readonly string[],
  items: AppState["runtimeItemsByIdByThread"][string],
  itemId: string,
): boolean {
  for (let index = ids.lastIndexOf(itemId) - 1; index >= 0; index -= 1) {
    const item = items[ids[index]!];
    if (!item) continue;
    if (item.type === "user_message" || item.type === "provider_handoff") return false;
    if (getRuntimeItemPayload<ErrorItemPayload>(item, "error")?.reason === USAGE_LIMITED_REASON) {
      return true;
    }
  }
  return false;
}

/**
 * True when the turn right before the divider `itemId` ended because the
 * account ran out of usage: an `error` item with reason `usage_limited`
 * between the previous user message (or divider) and this divider.
 *
 * Runs as a store selector, so it is called on every app-store update; the
 * transcript walk runs only when the thread's structure changed (see
 * `handoffScans`), never for a streaming delta.
 */
export function selectHandoffFollowsUsageLimit(
  state: AppState,
  threadId: string,
  itemId: string,
): boolean {
  const ids = state.runtimeItemIdsByThread[threadId];
  const items = state.runtimeItemsByIdByThread[threadId];
  if (!ids || !items) return false;
  const version = state.runtimeStructuralVersionByThread[threadId];
  let scan = handoffScans.get(ids);
  if (!scan || scan.version !== version) {
    scan = { version, results: new Map() };
    handoffScans.set(ids, scan);
  }
  const known = scan.results.get(itemId);
  if (known !== undefined) return known;
  const follows = scanHandoffFollowsUsageLimit(ids, items, itemId);
  scan.results.set(itemId, follows);
  return follows;
}

/** The divider text for an out-of-usage switch. */
export function usageLimitedHandoffMessage(fromLabel: string, toLabel: string): MessageDescriptor {
  return msg`Switched to ${toLabel} because ${fromLabel} ran out of usage`;
}

/**
 * For `ProviderHandoffRow`: the out-of-usage text when this divider follows
 * an exhausted account, otherwise undefined (the row keeps its own text).
 */
export function useUsageLimitedHandoffText(input: {
  threadId: string;
  itemId: string;
  payload: object;
  fromLabel: string;
  toLabel: string;
}): string | undefined {
  const { t } = useLingui();
  const followsUsageLimit = useAppStore((state) =>
    selectHandoffFollowsUsageLimit(state, input.threadId, input.itemId),
  );
  if (!followsUsageLimit && !isUsageLimitedHandoffPayload(input.payload)) return undefined;
  return t(usageLimitedHandoffMessage(input.fromLabel, input.toLabel));
}
