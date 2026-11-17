import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEWS_FEED_URL, NEWS_FEED_VERSION } from "@/shared/newsFeed";

const CACHE_KEY = "poracode-news-feed-cache";

describe("newsFeedStore without a feed source (ViscosityCode)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("ships without a feed source", () => {
    expect(NEWS_FEED_URL).toBeNull();
  });

  it("never fetches and ignores a feed cached by an earlier build", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now() - 24 * 60 * 60_000,
        feed: {
          version: NEWS_FEED_VERSION,
          items: [{ id: "hello", kind: "announcement", text: { en: "Hello" } }],
        },
      }),
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { useNewsFeedStore } = await import("./newsFeedStore");
    expect(useNewsFeedStore.getState().feed).toBeNull();

    await useNewsFeedStore.getState().refresh();
    await useNewsFeedStore.getState().refresh({ force: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useNewsFeedStore.getState()).toMatchObject({ feed: null, failedAt: 0 });
  });
});
