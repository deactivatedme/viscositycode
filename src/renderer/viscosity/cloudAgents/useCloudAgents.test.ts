import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAgentSummary, ListCloudAgentsResult } from "./cloudAgentsContract";
import { CLOUD_AGENTS_REFRESH_MS, mergeCloudAgentsPage, useCloudAgents } from "./useCloudAgents";

const host = vi.hoisted(() => ({
  list: vi.fn<(payload: unknown) => Promise<unknown>>(),
  present: true,
}));

vi.mock("./cloudAgentsContract", () => ({
  cloudAgentsBridge: () =>
    host.present
      ? {
          listCloudAgents: host.list,
          getCloudAgent: vi.fn<() => Promise<never>>(),
          followCloudAgent: vi.fn<() => Promise<never>>(),
        }
      : undefined,
}));

function agent(id: string): CloudAgentSummary {
  return {
    agentKind: "sample-profile",
    id,
    providerSessionId: `sdk:${id}`,
    name: id,
    status: "running",
    updatedAt: "2026-11-20T10:00:00.000Z",
    repos: [],
  };
}

const page = (ids: string[], nextCursor?: string): ListCloudAgentsResult => ({
  sources: [
    { agentKind: "sample-profile", items: ids.map(agent), ...(nextCursor ? { nextCursor } : {}) },
  ],
  fetchedAt: 1,
});

let focused = true;

beforeEach(() => {
  vi.useFakeTimers();
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  host.present = true;
  host.list.mockReset();
  host.list.mockResolvedValue(page(["a"]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useCloudAgents", () => {
  it("reads on mount and every 60 s while the window has focus", async () => {
    const { result } = renderHook(() => useCloudAgents());
    await flush();
    expect(host.list).toHaveBeenCalledTimes(1);
    expect(result.current.result?.sources[0]?.items.map((item) => item.id)).toEqual(["a"]);

    await act(async () => {
      vi.advanceTimersByTime(CLOUD_AGENTS_REFRESH_MS);
    });
    expect(host.list).toHaveBeenCalledTimes(2);
  });

  it("stops on blur, reads and restarts on focus, and clears the interval on unmount", async () => {
    const { unmount } = renderHook(() => useCloudAgents());
    await flush();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await act(async () => {
      vi.advanceTimersByTime(CLOUD_AGENTS_REFRESH_MS * 3);
    });
    expect(host.list).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(host.list).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(CLOUD_AGENTS_REFRESH_MS);
    });
    expect(host.list).toHaveBeenCalledTimes(3);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(CLOUD_AGENTS_REFRESH_MS * 3);
    });
    window.dispatchEvent(new Event("focus"));
    expect(host.list).toHaveBeenCalledTimes(3);
  });

  it("does not poll when it mounts in an unfocused window", async () => {
    focused = false;
    renderHook(() => useCloudAgents());
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(CLOUD_AGENTS_REFRESH_MS * 2);
    });
    expect(host.list).toHaveBeenCalledTimes(1);
  });

  it("passes refresh to the host only for an explicit refresh", async () => {
    const { result } = renderHook(() => useCloudAgents());
    await flush();
    act(() => result.current.refresh());
    expect(host.list).toHaveBeenLastCalledWith({ refresh: true });
    expect(host.list).toHaveBeenNthCalledWith(1, {});
  });

  it("reports a host without the cloud procedures", async () => {
    host.present = false;
    const { result } = renderHook(() => useCloudAgents());
    await flush();
    expect(result.current.unsupported).toBe(true);
    expect(host.list).not.toHaveBeenCalled();
  });

  it("appends a Load more page to its own source", async () => {
    host.list.mockResolvedValueOnce(page(["a"], "next"));
    const { result } = renderHook(() => useCloudAgents());
    await flush();
    host.list.mockResolvedValueOnce(page(["a", "b"]));
    act(() => result.current.loadMore("sample-profile"));
    await flush();
    expect(host.list).toHaveBeenLastCalledWith({ agentKind: "sample-profile", cursor: "next" });
    const source = result.current.result?.sources[0];
    expect(source?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(source?.nextCursor).toBeUndefined();
  });
});

describe("mergeCloudAgentsPage", () => {
  it("leaves other sources alone and ignores a page for an unknown source", () => {
    const current: ListCloudAgentsResult = {
      sources: [
        { agentKind: "one", items: [agent("a")], nextCursor: "c1" },
        { agentKind: "two", items: [agent("x")] },
      ],
      fetchedAt: 1,
    };
    const merged = mergeCloudAgentsPage(
      current,
      { sources: [{ agentKind: "one", items: [agent("b")], nextCursor: "c2" }], fetchedAt: 2 },
      "one",
    );
    expect(merged.sources[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged.sources[0]?.nextCursor).toBe("c2");
    expect(merged.sources[1]).toBe(current.sources[1]);
    expect(mergeCloudAgentsPage(current, { sources: [], fetchedAt: 3 }, "one")).toBe(current);
  });
});
