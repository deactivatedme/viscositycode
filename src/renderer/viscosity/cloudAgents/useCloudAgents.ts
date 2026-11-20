/**
 * ViscosityCode: the Cloud tab's list, read from the host.
 *
 * Pull-based and bounded: one read on mount, then one every 60 s only while
 * the tab is mounted and the window has focus. Blur and unmount clear the
 * interval; focus reads once and starts it again. The host caches each source
 * and backs off after errors, so a read here never reaches the provider more
 * often than the host allows.
 */
import { useEffect, useRef, useState } from "react";
import {
  cloudAgentsBridge,
  type CloudAgentSourceListing,
  type ListCloudAgentsResult,
} from "./cloudAgentsContract";

export const CLOUD_AGENTS_REFRESH_MS = 60_000;

export interface CloudAgentsState {
  /** The host has no cloud agent procedures. */
  unsupported: boolean;
  result: ListCloudAgentsResult | undefined;
  /** The last read failed as a whole (sources carry their own errors). */
  error: unknown;
  loading: boolean;
}

/** Appends a "Load more" page to its source, keeping every other source as it was. */
export function mergeCloudAgentsPage(
  current: ListCloudAgentsResult,
  page: ListCloudAgentsResult,
  agentKind: string,
): ListCloudAgentsResult {
  const next = page.sources.find((source) => source.agentKind === agentKind);
  if (!next) return current;
  const sources = current.sources.map((source): CloudAgentSourceListing => {
    if (source.agentKind !== agentKind) return source;
    const known = new Set(source.items.map((item) => item.id));
    const { nextCursor: _previous, ...rest } = source;
    return {
      ...rest,
      items: [...source.items, ...next.items.filter((item) => !known.has(item.id))],
      ...(next.nextCursor ? { nextCursor: next.nextCursor } : {}),
    };
  });
  return { ...current, sources };
}

export function useCloudAgents(): CloudAgentsState & {
  refresh: () => void;
  loadMore: (agentKind: string) => void;
} {
  const [state, setState] = useState<CloudAgentsState>(() => ({
    unsupported: cloudAgentsBridge() === undefined,
    result: undefined,
    error: undefined,
    loading: true,
  }));
  // Only the newest read may land; an older reply must not overwrite it.
  const generation = useRef(0);

  const read = (refresh: boolean) => {
    const bridge = cloudAgentsBridge();
    if (!bridge) {
      setState((current) => ({ ...current, unsupported: true, loading: false }));
      return;
    }
    const mine = ++generation.current;
    setState((current) => ({ ...current, loading: true }));
    bridge
      .listCloudAgents(refresh ? { refresh: true } : {})
      .then((result) => {
        if (mine !== generation.current) return;
        setState({ unsupported: false, result, error: undefined, loading: false });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current) return;
        setState((current) => ({ ...current, error, loading: false }));
      });
  };

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      if (timer === undefined) timer = setInterval(() => read(false), CLOUD_AGENTS_REFRESH_MS);
    };
    const onFocus = () => {
      read(false);
      start();
    };
    read(false);
    if (document.hasFocus()) start();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", stop);
    return () => {
      // A reply that lands after unmount is dropped.
      generation.current += 1;
      stop();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", stop);
    };
    // Mount-only: `read` reads the bridge and the generation at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = (agentKind: string) => {
    const bridge = cloudAgentsBridge();
    const cursor = state.result?.sources.find(
      (source) => source.agentKind === agentKind,
    )?.nextCursor;
    if (!bridge || !cursor) return;
    const mine = generation.current;
    bridge
      .listCloudAgents({ agentKind, cursor })
      .then((page) => {
        if (mine !== generation.current) return;
        setState((current) =>
          current.result
            ? { ...current, result: mergeCloudAgentsPage(current.result, page, agentKind) }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (mine !== generation.current) return;
        setState((current) => ({ ...current, error }));
      });
  };

  return { ...state, refresh: () => read(true), loadMore };
}
