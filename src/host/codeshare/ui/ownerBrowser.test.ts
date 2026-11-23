// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { parseModel, type OwnerState } from "@/shared/codeShare";
import { ownerBrowser } from "./ownerBrowser";
import { ownerPage } from "./pages";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

it("saves host-wide model choices separately from invite choices and disables unavailable models", async () => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = ownerPage;
  location.hash = "owner=" + "A".repeat(43);
  const model = { ...parseModel("codex:fixture"), execution: "owner-subscription" as const };
  const state: OwnerState = {
    paused: false,
    models: [model],
    enabledModels: [model.id],
    rooms: [],
    invites: [],
    guestOrigin: "https://share.example.test",
    serverNow: Date.now(),
  };
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith("/models") && options?.body)
      state.enabledModels = JSON.parse(String(options.body)).models;
    return Response.json(options?.method === "POST" ? { ok: true } : state);
  });
  vi.stubGlobal("fetch", request);
  ownerBrowser([{ id: "codex", label: "ChatGPT subscription", showInEmptyMenu: true }]);
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('input[name="enabled-model"]')?.checked).toBe(
      true,
    ),
  );
  const settingsCheckbox = document.querySelector<HTMLInputElement>('input[name="enabled-model"]')!;
  settingsCheckbox.checked = false;
  document
    .getElementById("model-settings")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('input[name="model"]')?.disabled).toBe(true),
  );
  expect(document.querySelector<HTMLButtonElement>("#create-button")?.disabled).toBe(true);
  expect(
    request.mock.calls.some(
      ([url, options]) =>
        String(url).endsWith("/models") && options?.body === JSON.stringify({ models: [] }),
    ),
  ).toBe(true);
  expect(document.querySelector("#enabled-model-list")?.textContent).toContain("Your subscription");
});

it("keeps a large inventory selectable while preserving the 64-model guest grant limit", async () => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = ownerPage;
  location.hash = "owner=" + "A".repeat(43);
  const models = Array.from({ length: 70 }, (_, id) => parseModel("openai:fixture-" + id));
  const state: OwnerState = {
    paused: false,
    models,
    enabledModels: models.map(({ id }) => id),
    rooms: [],
    invites: [],
    guestOrigin: "https://share.example.test",
    serverNow: Date.now(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => Response.json(state)),
  );
  ownerBrowser([{ id: "openai", label: "API models", showInEmptyMenu: true }]);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('input[name="enabled-model"]').length).toBe(70),
  );
  expect(document.querySelectorAll('input[name="model"]:checked').length).toBe(64);
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[name="model"]'))
    checkbox.checked = true;
  document.getElementById("model-list")!.dispatchEvent(new Event("change", { bubbles: true }));
  expect(document.querySelector<HTMLButtonElement>("#create-button")?.disabled).toBe(true);
});
