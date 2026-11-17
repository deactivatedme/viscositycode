// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { create } from "zustand";
import { NEWS_FEED_URL, parseNewsFeed, type NewsFeed } from "@/shared/newsFeed";
import { readStoredJson, writeStoredJson } from "@/renderer/utils/localStorage";

/**
 * The remote news feed (`NEWS_FEED_URL`), cached on the device so the news line
 * has content offline and instantly on launch. The fetch is anonymous: a static
 * GET with no credentials or identifiers. ViscosityCode ships without a feed
 * source, so it never fetches and ignores any cached feed.
 */
export const NEWS_FEED_CACHE_KEY = "poracode-news-feed-cache";
/** Refresh at most this often after a success; the website caches GitHub data hourly. */
export const NEWS_FEED_REFRESH_MS = 6 * 60 * 60_000;
/** Wait this long after a failed or unusable response before trying again. */
export const NEWS_FEED_RETRY_MS = 60 * 60_000;

function readCache(): { feed: NewsFeed | null; fetchedAt: number } {
  const cached = readStoredJson(NEWS_FEED_CACHE_KEY) as {
    fetchedAt?: unknown;
    feed?: unknown;
  } | null;
  const fetchedAt = typeof cached?.fetchedAt === "number" ? cached.fetchedAt : 0;
  // A timestamp from the future (clock change, corruption) must not block refreshes.
  return { feed: parseNewsFeed(cached?.feed), fetchedAt: Math.min(fetchedAt, Date.now()) };
}

interface NewsFeedState {
  feed: NewsFeed | null;
  fetchedAt: number;
  /** Last attempt that did not produce a usable feed. */
  failedAt: number;
  /** Fetch when the cache is stale. Failures keep the cached feed silently. */
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

let inFlight: Promise<void> | null = null;

async function fetchFeed(url: string): Promise<NewsFeed | null> {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) return null;
  const raw: unknown = await response.json();
  const feed = parseNewsFeed(raw);
  if (feed) writeStoredJson(NEWS_FEED_CACHE_KEY, { fetchedAt: Date.now(), feed: raw });
  return feed;
}

export const useNewsFeedStore = create<NewsFeedState>((set, get) => ({
  ...(NEWS_FEED_URL ? readCache() : { feed: null, fetchedAt: 0 }), // ViscosityCode
  failedAt: 0,
  refresh: (options) => {
    const url = NEWS_FEED_URL; // ViscosityCode: no source → no request
    if (!url) return Promise.resolve();
    const now = Date.now();
    const { fetchedAt, failedAt } = get();
    if (
      !options?.force &&
      (now - fetchedAt < NEWS_FEED_REFRESH_MS || now - failedAt < NEWS_FEED_RETRY_MS)
    ) {
      return Promise.resolve();
    }
    inFlight ??= fetchFeed(url)
      .then((feed) => set(feed ? { feed, fetchedAt: Date.now() } : { failedAt: Date.now() }))
      // Offline, blocked, or malformed: keep what we have and back off.
      .catch(() => set({ failedAt: Date.now() }))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));
