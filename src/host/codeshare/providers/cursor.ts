import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { cursorCodeShareId } from "@/shared/agents/cursorCodeShare";
import { readBoundedResponseBody } from "@/shared/remote/responseBody";
import { ProviderFailure, statusIssue, type CodeShareCloudProvider } from "../providerTransport";

const api = "https://api.cursor.com/v1";
const agentId = z.string().regex(/^bc-[a-f0-9-]{36}$/iu);
const runId = z.string().regex(/^run-[a-f0-9-]{36}$/iu);
const created = z.object({ agent: z.object({ id: agentId }), run: z.object({ id: runId }) });
const modelCatalogue = z.object({ items: z.array(z.object({ id: z.string() })) });
const runStatus = z.object({
  status: z.enum([
    "CREATING",
    "RUNNING",
    "WAITING_FOR_BACKGROUND_WORK",
    "FINISHED",
    "ERROR",
    "CANCELLED",
    "EXPIRED",
  ]),
  result: z.string().nullish(),
});

async function cursorRequest(
  key: string,
  path: string,
  request: typeof fetch,
  signal: AbortSignal,
  data?: object,
): Promise<Response> {
  const response = await request(api + path, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }),
    redirect: "error",
    signal,
  });
  return response;
}

async function cursorJson<T>(
  key: string,
  path: string,
  request: typeof fetch,
  signal: AbortSignal,
  schema: z.ZodType<T>,
  data?: object,
): Promise<T> {
  const response = await cursorRequest(key, path, request, signal, data);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderFailure(statusIssue(response.status));
  }
  const buffer = await readBoundedResponseBody(response, 512 * 1024);
  const result = schema.safeParse(JSON.parse(new TextDecoder().decode(buffer)));
  if (!result.success) throw new ProviderFailure("provider_unavailable");
  return result.data;
}

const secretList = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().nullish(),
});

async function assertNoVisibleSecrets(
  key: string,
  request: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const secrets = await cursorJson(key, "/secrets?limit=1", request, signal, secretList);
  if (secrets.items.length || secrets.nextCursor) throw new ProviderFailure("provider_access");
}

export const cursorSharing: CodeShareCloudProvider = {
  id: cursorCodeShareId,
  ownerLabel: "Cursor",
  showInEmptyOwnerMenu: true,
  keyEnvironmentVariable: "CODESHARE_CURSOR_API_KEY",
  async discoverModels(key, request) {
    const signal = AbortSignal.timeout(10_000);
    const [catalogue] = await Promise.all([
      cursorJson(key, "/models", request, signal, modelCatalogue),
      assertNoVisibleSecrets(key, request, signal),
    ]);
    return catalogue.items.map(({ id }) => id);
  },
  async validateModel(model, key, request) {
    let catalogue: z.infer<typeof modelCatalogue>;
    try {
      const signal = AbortSignal.timeout(10_000);
      [catalogue] = await Promise.all([
        cursorJson(key, "/models", request, signal, modelCatalogue),
        assertNoVisibleSecrets(key, request, signal),
      ]);
    } catch (error) {
      throw new Error(`cursor:${model} catalogue could not be read`, { cause: error });
    }
    if (!catalogue.items.some((item) => item.id === model))
      throw new Error(`cursor:${model} is absent from the exact IDs in the Cloud Agents catalogue`);
  },
  async run(input, key, request) {
    const { signal, model, messages, append } = input;
    signal.throwIfAborted();
    await assertNoVisibleSecrets(key, request, signal);
    signal.throwIfAborted();
    // A newly created worktree is owned by the cloud agent. No host repo,
    // environment, secret, or tool binding is included in the launch.
    const prompt = messages.map(({ role, content }) => `${role}:\n${content}`).join("\n\n");
    // Keep the create receipt readable even if the guest revokes access while
    // Cursor provisions the job, so we can immediately cancel the returned run.
    const agent = await cursorJson(key, "/agents", request, AbortSignal.timeout(15_000), created, {
      prompt: { text: prompt },
      model: { id: model.model },
      autoCreatePR: false,
    });
    const path = `/agents/${agent.agent.id}/runs/${agent.run.id}`;
    let terminal = false;
    try {
      for (;;) {
        const run = await cursorJson(key, path, request, signal, runStatus);
        if (run.status === "FINISHED") {
          terminal = true;
          if (!run.result) throw new ProviderFailure("provider_unavailable");
          append(run.result);
          return null;
        }
        if (run.status === "ERROR" || run.status === "CANCELLED" || run.status === "EXPIRED") {
          terminal = true;
          throw new ProviderFailure("provider_unavailable");
        }
        await wait(1200, undefined, { signal });
      }
    } finally {
      if (!terminal) {
        const result = await cursorRequest(
          key,
          path + "/cancel",
          request,
          AbortSignal.timeout(5_000),
          {},
        ).catch(() => null);
        await result?.body?.cancel().catch(() => undefined);
        if (!result || (!result.ok && result.status !== 409)) {
          process.stderr.write(
            "CodeShare could not confirm cancellation of a Cursor Cloud run. Check the Cursor dashboard.\n",
          );
        }
      }
    }
  },
};
