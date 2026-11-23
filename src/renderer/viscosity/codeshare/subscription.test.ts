import { expect, it } from "vitest";
import { usesGuestSubscription } from "./subscription";

it("accepts each guest's signed-in account and keeps ChatGPT and Claude API keys out", () => {
  expect(
    usesGuestSubscription({
      kind: "codex",
      authState: "authenticated",
      providerMetadata: { plan: "Plus" },
    }),
  ).toBe(true);
  expect(
    usesGuestSubscription({
      kind: "codex",
      authState: "authenticated",
      providerMetadata: { authMethod: "API Key" },
    }),
  ).toBe(false);
  expect(
    usesGuestSubscription({
      kind: "claude",
      authState: "authenticated",
      providerMetadata: { authMethod: "Claude.ai", plan: "Max" },
    }),
  ).toBe(true);
  expect(
    usesGuestSubscription({
      kind: "claude",
      authState: "authenticated",
      providerMetadata: { authMethod: "API Key", plan: "Max" },
    }),
  ).toBe(false);
  expect(usesGuestSubscription({ kind: "devin", authState: "authenticated" })).toBe(true);
  expect(usesGuestSubscription({ kind: "devin", authState: "unknown" })).toBe(false);
});
