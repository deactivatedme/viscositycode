// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { CodeShareSetupSnapshot } from "@/shared/codeShareSetup";
import { ownerPage } from "./pages";
import { setupBrowser } from "./setupBrowser";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("submits keys only in owner mutations, clears the password field, and exposes normal sign-in links", async () => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = ownerPage;
  const state: CodeShareSetupSnapshot = {
    subscriptions: [
      {
        id: "claude",
        label: "Claude",
        connected: false,
        state: "waiting",
        url: "https://claude.ai/oauth/authorize?state=fixture",
      },
    ],
    apiKeys: [
      { id: "cursor", label: "Cursor", configured: false, discoverModels: true, models: [] },
    ],
    cloudflare: {
      id: "cloudflare",
      label: "Cloudflare",
      state: "idle",
      connected: false,
      running: false,
      verified: false,
      publishing: false,
    },
  };
  const request = vi.fn<(path: string, data?: object) => Promise<unknown>>(async () => state);
  const changed = vi.fn<() => Promise<void>>(async () => {});
  setupBrowser(request as <T>(path: string, data?: object) => Promise<T>, changed);
  await vi.waitFor(() =>
    expect(document.querySelector("#subscription-connections a")?.getAttribute("href")).toBe(
      state.subscriptions[0]!.url,
    ),
  );
  const key = document.getElementById("provider-key") as HTMLInputElement;
  key.value = "private-key-fixture";
  document
    .getElementById("api-key-setup")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(key.value).toBe("");
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith("/setup/keys", {
      action: "save",
      provider: "cursor",
      key: "private-key-fixture",
      models: [],
    }),
  );
  expect(document.body.textContent).not.toContain("private-key-fixture");
  expect(document.querySelector<HTMLInputElement>("#provider-key")?.type).toBe("password");
});
