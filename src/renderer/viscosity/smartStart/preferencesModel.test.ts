import { describe, expect, it } from "vitest";
import { smartStartAccountName, smartStartPickName } from "./labels";
import { completeProviderOrder, moveProvider } from "./preferencesModel";

describe("completeProviderOrder", () => {
  it("lists the order first, then known providers it misses, without duplicates", () => {
    expect(completeProviderOrder(["b", "a"], ["a", "c", "b", "d"])).toEqual(["b", "a", "c", "d"]);
    expect(completeProviderOrder([], ["a", "a"])).toEqual(["a"]);
  });
});

describe("moveProvider", () => {
  it("moves an entry up or down by one", () => {
    expect(moveProvider(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveProvider(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("leaves the order unchanged past either end", () => {
    expect(moveProvider(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveProvider(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveProvider(["a", "b"], 5, -1)).toEqual(["a", "b"]);
  });
});

describe("pick names", () => {
  const instances = {
    work: { id: "work", driver: "alpha", displayName: " Work ", config: {} },
  } as never;

  it("names a profile account by its display name, else its id", () => {
    expect(smartStartAccountName("alpha:work", instances)).toBe("Work");
    expect(smartStartAccountName("alpha:home", instances)).toBe("home");
    expect(smartStartAccountName("alpha", instances)).toBeUndefined();
  });

  it("joins provider, account and model, skipping missing or repeated parts", () => {
    expect(
      smartStartPickName({ providerLabel: "Alpha", accountName: "Work", modelLabel: "Big" }),
    ).toBe("Alpha · Work · Big");
    expect(smartStartPickName({ providerLabel: "Alpha", accountName: "Alpha" })).toBe("Alpha");
    expect(smartStartPickName({ providerLabel: "Alpha", modelLabel: "Big" })).toBe("Alpha · Big");
  });
});
