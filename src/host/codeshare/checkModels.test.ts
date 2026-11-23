import { expect, it, vi } from "vitest";
import { parseModel } from "@/shared/codeShare";
import { verifyCodeShareModels } from "./checkModels";

it("checks every requested CodeShare ID with its own authenticated catalogue", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: "gpt-5.4" }))
    .mockResolvedValueOnce(Response.json({ id: "claude-fable-5-2" }))
    .mockResolvedValueOnce(Response.json({ id: "grok-4.7" }));
  await verifyCodeShareModels(
    ["openai:gpt-5.4", "anthropic:claude-fable-5-2", "xai:grok-4.7"].map(parseModel),
    { openai: "openai-fixture", anthropic: "anthropic-fixture", xai: "xai-fixture" },
    fetcher,
  );
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "https://api.openai.com/v1/models/gpt-5.4",
    "https://api.anthropic.com/v1/models/claude-fable-5-2",
    "https://api.x.ai/v1/language-models/grok-4.7",
  ]);
  expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ "x-api-key": "anthropic-fixture" });
});

it("reports conflicting IDs and missing access before publishing an invite host", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: "claude-fable-5-1" }))
    .mockResolvedValueOnce(new Response("unshareable diagnostic", { status: 403 }));
  await expect(
    verifyCodeShareModels(
      ["anthropic:claude-fable-5-2", "xai:grok-4.7"].map(parseModel),
      { anthropic: "fixture", xai: "fixture" },
      fetcher,
    ),
  ).rejects.toThrow(
    "anthropic:claude-fable-5-2 catalogue returned different model ID claude-fable-5-1. xai:grok-4.7 catalogue returned HTTP 403",
  );
});
