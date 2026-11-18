/**
 * ViscosityCode: the last-used provider order for Smart start (fork of Poracode).
 *
 * The default preference order: providers the owner started threads with by
 * hand (most recent first), then providers of existing threads by activity.
 * The thread list is read once per mount, because it changes on every status
 * update and the order only needs to be roughly current.
 */
import { useState } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import { lastUsedProviderOrder, threadProviderOrder } from "./scoring";
import { useSmartStartStore } from "./smartStartStore";

export function useLastUsedProviderOrder(): string[] {
  const recentProviders = useSmartStartStore((state) => state.recentProviders);
  const [threadProviders] = useState(() => threadProviderOrder(useAppStore.getState().threads));
  return lastUsedProviderOrder(recentProviders, threadProviders);
}
