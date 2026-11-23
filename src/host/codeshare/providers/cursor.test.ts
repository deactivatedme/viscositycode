import { expect, it, vi } from "vitest";
import { parseModel } from "@/shared/codeShare";
import { cursorSharing } from "./cursor";

const agentId = "bc-00000000-0000-0000-0000-000000000001";
const runId = "run-00000000-0000-0000-0000-000000000002";
const model = parseModel("cursor:composer-2.5");
const messages = [{ role: "user" as const, content: "Explain this snippet" }];
const emptySecrets = () => Response.json({ items: [], nextCursor: null });

it("accepts only an exact catalog ID and a workspace without visible secrets", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: model.model, aliases: ["composer-latest"] }] }),
    )
    .mockResolvedValueOnce(emptySecrets());
  await expect(
    cursorSharing.validateModel(model.model, "fixture", fetcher),
  ).resolves.toBeUndefined();

  const alias = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: model.model, aliases: ["composer-latest"] }] }),
    )
    .mockResolvedValueOnce(emptySecrets());
  await expect(cursorSharing.validateModel("composer-latest", "fixture", alias)).rejects.toThrow(
    "absent",
  );
});

it("launches an exact-model, repository-free Cursor Cloud run", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(emptySecrets())
    .mockResolvedValueOnce(Response.json({ agent: { id: agentId }, run: { id: runId } }))
    .mockResolvedValueOnce(Response.json({ status: "FINISHED", result: "Cloud reply" }));
  const append = vi.fn<(text: string) => void>();
  await cursorSharing.run(
    { model, messages, append, signal: new AbortController().signal },
    "fixture",
    fetcher,
  );
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
    prompt: { text: "user:\nExplain this snippet" },
    model: { id: model.model },
    autoCreatePR: false,
  });
  expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer fixture" });
  expect(append).toHaveBeenCalledWith("Cloud reply");
});

it("cancels a created run if the guest leaves before the creation receipt returns", async () => {
  const controller = new AbortController();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(emptySecrets())
    .mockImplementationOnce(async () => {
      controller.abort();
      return Response.json({ agent: { id: agentId }, run: { id: runId } });
    })
    .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const append = vi.fn<(text: string) => void>();
  await expect(
    cursorSharing.run({ model, messages, append, signal: controller.signal }, "fixture", fetcher),
  ).rejects.toThrow("Aborted");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    `https://api.cursor.com/v1/agents/${agentId}/runs/${runId}/cancel`,
  );
  expect(append).not.toHaveBeenCalled();
});

it("blocks creation when host account secrets are visible", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ items: [{}] }));
  const append = vi.fn<(text: string) => void>();
  await expect(
    cursorSharing.run(
      { model, messages, append, signal: new AbortController().signal },
      "fixture",
      fetcher,
    ),
  ).rejects.toMatchObject({ issue: "provider_access" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("discovers exact key-entitled models without creating any cloud run", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: "fixture-grok" }, { id: "fixture-composer" }] }),
    )
    .mockResolvedValueOnce(emptySecrets());
  await expect(cursorSharing.discoverModels!("fixture", fetcher)).resolves.toEqual([
    "fixture-grok",
    "fixture-composer",
  ]);
  expect(fetcher.mock.calls.every(([, options]) => options?.method === undefined)).toBe(true);
});
