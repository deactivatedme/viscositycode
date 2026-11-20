import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppStoreState } from "./slices/shared";
import { selectInactiveRuntimeEvictions } from "./inactiveRuntimeRetention";

const { lightweightMock } = vi.hoisted(() => ({ lightweightMock: { active: false } }));
vi.mock("@/renderer/viscosity/performance/lightweight", () => ({
  isLightweightActive: () => lightweightMock.active,
}));

const MiB = 1024 * 1024;

/** Inactive thread windows holding roughly `mib` MiB each (UTF-16 estimate). */
function stateWith(sizesMib: Record<string, number>): AppStoreState {
  const items: Record<string, unknown> = {};
  for (const [threadId, mib] of Object.entries(sizesMib)) {
    items[threadId] = { text: "x".repeat((mib * MiB) / 2) };
  }
  return {
    runtimeItemIdsByThread: {},
    runtimeItemsByIdByThread: items,
    runtimeCompletedTurnsByThread: {},
    runtimeContextByThread: {},
    runtimeBackgroundTasksByThread: {},
    runtimeOpenTurnByThread: {},
  } as unknown as AppStoreState;
}

describe("selectInactiveRuntimeEvictions", () => {
  afterEach(() => {
    lightweightMock.active = false;
  });

  it("keeps up to 10 small inactive threads when Lightweight is off", () => {
    const sizes = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`t${i}`, 1]));
    expect(selectInactiveRuntimeEvictions(stateWith(sizes), new Set(Object.keys(sizes)))).toEqual(
      [],
    );
  });

  it("evicts the oldest down to 3 threads in Lightweight", () => {
    lightweightMock.active = true;
    const sizes = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`t${i}`, 1]));
    expect(selectInactiveRuntimeEvictions(stateWith(sizes), new Set(Object.keys(sizes)))).toEqual([
      "t0",
      "t1",
    ]);
  });

  it("holds Lightweight to 16 MiB in total and 8 MiB per thread", () => {
    lightweightMock.active = true;
    // 7 + 7 + 7 MiB exceeds 16 MiB in total: the oldest leaves.
    expect(
      selectInactiveRuntimeEvictions(stateWith({ a: 7, b: 7, c: 7 }), new Set(["a", "b", "c"])),
    ).toEqual(["a"]);
    // A newer 9 MiB window exceeds the per-thread cap even within the total budget.
    expect(selectInactiveRuntimeEvictions(stateWith({ a: 1, b: 9 }), new Set(["a", "b"]))).toEqual([
      "b",
    ]);
  });

  it("keeps a 9 MiB window when Lightweight is off", () => {
    expect(selectInactiveRuntimeEvictions(stateWith({ a: 1, b: 9 }), new Set(["a", "b"]))).toEqual(
      [],
    );
  });
});
