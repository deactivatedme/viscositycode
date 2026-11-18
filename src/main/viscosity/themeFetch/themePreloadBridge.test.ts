import { describe, expect, it, vi } from "vitest";
import { THEME_FETCH_IPC } from "./themeFetchContract";
import { createViscosityThemePreloadBridge, type ThemeFetchPreloadIpc } from "./themePreloadBridge";

function fakeIpc(reply: unknown) {
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(reply),
  );
  return { ipc: { invoke } as unknown as ThemeFetchPreloadIpc, invoke };
}

describe("window.viscosityHost.themes preload bridge", () => {
  it("invokes the fork channel and passes a valid reply through", async () => {
    const reply = { ok: true, value: { text: "{}", url: "https://example.com/t.json" } };
    const { ipc, invoke } = fakeIpc(reply);
    const bridge = createViscosityThemePreloadBridge(ipc);
    expect(bridge.available).toBe(true);
    await expect(bridge.fetchTheme("https://example.com/t.json")).resolves.toEqual(reply);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      THEME_FETCH_IPC.fetch,
      "https://example.com/t.json",
    );
  });

  it("turns malformed replies into a network failure", async () => {
    const { ipc } = fakeIpc({ ok: true, value: { text: 5 } });
    await expect(
      createViscosityThemePreloadBridge(ipc).fetchTheme("https://example.com/t.json"),
    ).resolves.toEqual({ ok: false, error: { code: "network" } });
  });

  it("refuses a non-string URL without calling main", async () => {
    const { ipc, invoke } = fakeIpc(null);
    const bridge = createViscosityThemePreloadBridge(ipc);
    await expect(bridge.fetchTheme(42 as unknown as string)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-url" },
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
