// ViscosityCode (fork of Poracode): the credentials file's rateLimitTier tells Ultra from Max.
import { describe, expect, it } from "vitest";
import { CLAUDE_USAGE_ENDPOINT, collectClaude } from "@poracode/agents-usage";
import { createFakeHost } from "../../../packages/agents-usage/src/testHost";
import { parseClaudeCredentials } from "./claudeCredentials";

describe("Claude plan from the credentials file", () => {
  it.each([
    ["default_claude_max_20x", "Ultra"],
    ["default_claude_max_5x", "Max"],
  ])("labels rateLimitTier %s as %s in the usage snapshot", async (rateLimitTier, plan) => {
    const token = parseClaudeCredentials(
      JSON.stringify({
        claudeAiOauth: { accessToken: "acc", subscriptionType: "max", rateLimitTier },
      }),
    );
    const snapshot = await collectClaude(
      createFakeHost({
        tokens: { claude: token! },
        routes: { [CLAUDE_USAGE_ENDPOINT]: { body: JSON.stringify({}) } },
      }),
    );
    expect(snapshot.plan).toBe(plan);
  });
});
