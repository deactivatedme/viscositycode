// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { parseModel, type GuestState } from "@/shared/codeShare";
import type { ShareRoomSnapshot } from "@/shared/codeShareRoom";
import { guestPage } from "./pages";
import { roomBrowser } from "./roomBrowser";

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows shared authors, owner-funded host routing, queue state, and hides history on expiry", async () => {
  document.documentElement.innerHTML = guestPage;
  const model = parseModel("codex:shared");
  (document.getElementById("model") as HTMLSelectElement).append(new Option("Shared", model.id));
  const snapshot: ShareRoomSnapshot = {
    protocolVersion: 2,
    revision: 1,
    memberId: crypto.randomUUID(),
    active: true,
    members: [],
    turns: [
      {
        id: crypto.randomUUID(),
        authorId: crypto.randomUUID(),
        authorName: "Alex",
        runner: "host",
        runnerName: "Host",
        model: model.id,
        prompt: "Shared task",
        reply: "Shared reply",
        status: "complete",
      },
    ],
  };
  const request = vi.fn<(path: string, data?: object) => Promise<unknown>>(async () => snapshot);
  const view = roomBrowser(request as <T>(path: string, data?: object) => Promise<T>);
  const state: GuestState = {
    status: "active",
    expiresAt: Date.now() + 60000,
    serverNow: Date.now(),
    turnsRemaining: 2,
    models: [model],
    turns: [],
    room: { id: crypto.randomUUID(), label: "Together" },
  };
  view.render(state);
  await view.refresh(state);
  expect(document.getElementById("messages")?.textContent).toContain("Alex");
  expect(document.getElementById("messages")?.textContent).toContain("Shared reply");
  expect(view.runner()).toBe("host");
  expect(view.canSend()).toBe(true);
  view.render({ ...state, status: "expired", models: [] });
  expect(document.getElementById("messages")?.textContent).not.toContain("Shared reply");
  expect(view.canSend()).toBe(false);
});
