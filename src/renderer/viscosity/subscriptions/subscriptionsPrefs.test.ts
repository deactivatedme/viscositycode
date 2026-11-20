import { afterEach, describe, expect, it } from "vitest";
import { pretendSubscriptionProviders, pretendWindowId } from "./pretendSubscriptions";
import {
  deletePretendSubscription,
  MAX_ORDERED_PROVIDERS,
  MAX_PRETEND_BARS,
  MAX_PRETEND_SUBSCRIPTIONS,
  moveSubscriptionProvider,
  readSubscriptionsPrefs,
  reorderSubscriptionProvider,
  sanitizePretendList,
  savePretendSubscription,
  SUBSCRIPTIONS_PREFS_KEY,
  subscriptionRank,
  useSubscriptionsPrefsStore,
  writeSubscriptionsPrefs,
} from "./subscriptionsPrefs";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SUBSCRIPTIONS_PREFS_KEY, initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const entry = {
  id: "fun-1",
  provider: "Claude Code",
  plan: "Ultra",
  account: "me@example.com",
  bars: [{ label: "Weekly", usedPercent: 30, reset: "Resets in 2h" }],
};

afterEach(() => {
  localStorage.clear();
  useSubscriptionsPrefsStore.setState({ providerOrder: [], pretend: [], overrides: [] });
});

describe("subscriptions prefs storage", () => {
  it("round-trips the order and pretend entries", () => {
    const storage = memoryStorage();
    writeSubscriptionsPrefs(
      { providerOrder: ["codex", "claude"], pretend: [entry], overrides: [] },
      storage,
    );
    expect(JSON.parse(storage.values.get(SUBSCRIPTIONS_PREFS_KEY)!).version).toBe(1);
    expect(readSubscriptionsPrefs(storage)).toEqual({
      providerOrder: ["codex", "claude"],
      pretend: [entry],
      overrides: [],
    });
  });

  it("reads a foreign version, malformed JSON and a throwing storage as empty", () => {
    const empty = { providerOrder: [], pretend: [], overrides: [] };
    expect(
      readSubscriptionsPrefs(memoryStorage(JSON.stringify({ version: 2, providerOrder: ["a"] }))),
    ).toEqual(empty);
    expect(readSubscriptionsPrefs(memoryStorage("{nope"))).toEqual(empty);
    expect(
      readSubscriptionsPrefs({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(empty);
    expect(() =>
      writeSubscriptionsPrefs(empty, {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });

  it("drops duplicate, non-string and overlong ids and caps the order", () => {
    const ids = Array.from({ length: 80 }, (_, index) => `p${index}`);
    const raw = JSON.stringify({
      version: 1,
      providerOrder: ["a", "a", 3, "", "x".repeat(201), ...ids],
    });
    const order = readSubscriptionsPrefs(memoryStorage(raw)).providerOrder;
    expect(order.slice(0, 2)).toEqual(["a", "p0"]);
    expect(order).toHaveLength(MAX_ORDERED_PROVIDERS);
  });

  it("sanitizes pretend entries: required fields, lengths, bars, ids and count", () => {
    const list = sanitizePretendList([
      { ...entry, provider: `  ${"P".repeat(100)}\n` },
      { ...entry, id: "fun-1" },
      { ...entry, id: "no plan", plan: "Ultra" },
      { ...entry, id: "no-plan", plan: "   " },
      {
        id: "bars",
        provider: "Grok",
        plan: "Heavy",
        account: 42,
        bars: [
          { label: "A", usedPercent: 140.4 },
          { label: "B", usedPercent: -5, reset: 7 },
          { label: "", usedPercent: 10 },
          { label: "C", usedPercent: "10" },
          { label: "D", usedPercent: 50 },
          { label: "E", usedPercent: 50 },
          { label: "F", usedPercent: 50 },
          { label: "G", usedPercent: 50 },
          { label: "H", usedPercent: 50 },
          { label: "I", usedPercent: 50 },
          { label: "J", usedPercent: 50 },
        ],
      },
      "junk",
    ]);
    expect(list.map((item) => item.id)).toEqual(["fun-1", "bars"]);
    expect(list[0]!.provider).toBe("P".repeat(60));
    expect(list[1]).toEqual({
      id: "bars",
      provider: "Grok",
      plan: "Heavy",
      bars: [
        { label: "A", usedPercent: 100 },
        { label: "B", usedPercent: 0 },
        { label: "D", usedPercent: 50 },
        { label: "E", usedPercent: 50 },
        { label: "F", usedPercent: 50 },
        { label: "G", usedPercent: 50 },
        { label: "H", usedPercent: 50 },
        { label: "I", usedPercent: 50 },
      ],
    });
    expect(list[1]!.bars).toHaveLength(MAX_PRETEND_BARS);
    const many = Array.from({ length: 30 }, (_, index) => ({ ...entry, id: `e${index}` }));
    expect(sanitizePretendList(many)).toHaveLength(MAX_PRETEND_SUBSCRIPTIONS);
  });
});

describe("subscriptionRank", () => {
  it("puts saved ids first and the rest after them in fallback rank", () => {
    const rank = subscriptionRank(["b", "a"], (id) => ({ c: 5, d: 1 })[id] ?? 99);
    expect(["a", "b", "c", "d"].toSorted((left, right) => rank(left) - rank(right))).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
  });
});

describe("moveSubscriptionProvider", () => {
  it("keeps a hidden provider's slot", () => {
    expect(moveSubscriptionProvider(["a", "hidden", "b", "c"], ["a", "b", "c"], "c", 0)).toEqual([
      "c",
      "hidden",
      "a",
      "b",
    ]);
  });

  it("moves down and up and appends never-saved visible ids", () => {
    expect(moveSubscriptionProvider(["a", "b"], ["a", "b", "new"], "a", 2)).toEqual([
      "b",
      "new",
      "a",
    ]);
    expect(moveSubscriptionProvider([], ["a", "b", "c"], "c", 1)).toEqual(["a", "c", "b"]);
  });

  it("no-ops on an unknown id, the same index or an out-of-range index", () => {
    expect(moveSubscriptionProvider(["a"], ["a", "b"], "zzz", 0)).toEqual(["a"]);
    expect(moveSubscriptionProvider(["a"], ["a", "b"], "a", 0)).toEqual(["a"]);
    expect(moveSubscriptionProvider(["a"], ["a", "b"], "a", 5)).toEqual(["a"]);
  });
});

describe("store actions", () => {
  it("reorders, saves, edits and deletes pretend entries and persists them", () => {
    reorderSubscriptionProvider(["codex", "vc-pretend:fun-1"], "vc-pretend:fun-1", 0);
    expect(savePretendSubscription(entry)).toBe(true);
    expect(savePretendSubscription({ ...entry, plan: "Pro" })).toBe(true);
    expect(savePretendSubscription({ ...entry, id: "bad", plan: "" })).toBe(false);
    const stored = readSubscriptionsPrefs();
    expect(stored.providerOrder).toEqual(["vc-pretend:fun-1", "codex"]);
    expect(stored.pretend).toEqual([{ ...entry, plan: "Pro" }]);

    deletePretendSubscription("fun-1");
    expect(readSubscriptionsPrefs()).toEqual({
      providerOrder: ["codex"],
      pretend: [],
      overrides: [],
    });
  });

  it("adopts another tab's save, so its next save keeps that tab's entries", () => {
    // Tab A saved a pretend entry; this tab still holds the old empty copy.
    writeSubscriptionsPrefs({ providerOrder: [], pretend: [entry], overrides: [] });
    window.dispatchEvent(new StorageEvent("storage", { key: SUBSCRIPTIONS_PREFS_KEY }));
    expect(useSubscriptionsPrefsStore.getState().pretend).toEqual([entry]);

    reorderSubscriptionProvider(["codex", "claude"], "claude", 0);
    expect(readSubscriptionsPrefs()).toEqual({
      providerOrder: ["claude", "codex"],
      pretend: [entry],
      overrides: [],
    });
  });

  it("refuses a new entry past the cap", () => {
    for (let index = 0; index < MAX_PRETEND_SUBSCRIPTIONS; index++) {
      expect(savePretendSubscription({ ...entry, id: `e${index}` })).toBe(true);
    }
    expect(savePretendSubscription({ ...entry, id: "one-more" })).toBe(false);
  });
});

describe("pretendSubscriptionProviders", () => {
  it("shapes an entry like a real signed-in provider row", () => {
    const now = 1_800_000_000_000;
    const [provider] = pretendSubscriptionProviders(
      [{ ...entry, bars: [...entry.bars, { label: "5h", usedPercent: 100 }] }],
      now,
      (name) => (name === "Claude Code" ? "claude" : undefined),
    );
    expect(provider).toMatchObject({
      id: "vc-pretend:fun-1",
      label: "Claude Code",
      pretendId: "fun-1",
      styleKind: "claude",
      supportsPool: false,
    });
    const account = provider!.accounts[0]!;
    expect(account).toMatchObject({
      label: "me@example.com",
      readiness: "signed-in",
      hasUsageData: true,
      resetTexts: { [pretendWindowId(0)]: "Resets in 2h" },
    });
    expect(account.snapshot?.plan).toBe("Ultra");
    expect(account.snapshot?.fetchedAt).toBe(0);
    // 100% used reads as out of usage, like a real row.
    expect(account.availability.kind).toBe("exhausted");
  });
});
