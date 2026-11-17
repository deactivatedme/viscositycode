import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANGELOG_URL, hasChangelogSource } from "@/shared/changelog";

function setAppVersion(version: string): void {
  Object.defineProperty(window, "poracode", {
    configurable: true,
    value: { appVersion: version },
  });
}

describe("changelogStore without a changelog source (ViscosityCode)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    setAppVersion("1.5.1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("ships without a changelog source", () => {
    expect(CHANGELOG_URL).toBeNull();
    expect(hasChangelogSource()).toBe(false);
  });

  it("never fetches, shows no cached notes, and keeps What's New hidden after an update", async () => {
    localStorage.setItem("poracode-changelog-seen-version", "1.5.0");
    localStorage.setItem("poracode-changelog-ack-version", "1.5.0");
    localStorage.setItem(
      "poracode-changelog-cache",
      JSON.stringify({
        releases: [
          { version: "1.5.1", date: "2026-11-01", title: "New", summary: "New", changes: [] },
        ],
      }),
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { useChangelogStore, useHasUnseenChangelog } = await import("./changelogStore");
    useChangelogStore.getState().bootstrapSeenState();
    await useChangelogStore.getState().loadChangelog();
    useChangelogStore.getState().openWhatsNew();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useChangelogStore.getState().releases).toEqual([]);
    expect(useChangelogStore.getState().whatsNewHidden).toBe(true);
    const { result } = renderHook(() => useHasUnseenChangelog());
    expect(result.current).toBe(false);
  });
});
