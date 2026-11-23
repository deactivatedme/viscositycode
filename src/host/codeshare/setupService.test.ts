import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { configureSecretStorageKey } from "@/shared/secretStorage";
import type { CodeShareSetupSnapshot } from "@/shared/codeShareSetup";
import type { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import { CodeShareSetupStore } from "./setupStore";
import { CodeShareOwnerSetup } from "./setupService";
import type { CodeShareCloudflareSetup } from "./cloudflareSetup";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("validates a replacement before saving, returns only configured flags, and removes saved access", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-key-setup-"));
  roots.push(root);
  configureSecretStorageKey(Buffer.alloc(32, 6).toString("base64"));
  const store = new CodeShareSetupStore(join(root, "setup.enc"));
  await store.load();
  const keys: Record<string, string | undefined> = { cursor: "previous-key-fixture" };
  const supervisor: Pick<SupervisorClient, "callCodeShare"> = {
    async callCodeShare<Result>() {
      return [] as unknown as Result;
    },
  };
  const cloudflare = {
    async snapshot(): Promise<CodeShareSetupSnapshot["cloudflare"]> {
      return {
        id: "cloudflare",
        label: "Cloudflare",
        connected: false,
        state: "idle",
        running: false,
        verified: false,
        publishing: false,
      };
    },
    async close() {},
  } as CodeShareCloudflareSetup;
  const refresh = vi.fn<() => Promise<void>>(async () => {});
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes("/secrets")
        ? Response.json({ items: [] })
        : Response.json({ items: [{ id: "fixture-model" }] }),
    );
  const apply = () => {
    const value = store.read().keys.cursor;
    if (value === null) delete keys.cursor;
    else if (value) keys.cursor = value;
  };
  const setup = new CodeShareOwnerSetup(
    store,
    keys,
    supervisor,
    cloudflare,
    refresh,
    () => [],
    apply,
    fetcher,
  );
  await setup.saveKey({
    action: "save",
    provider: "cursor",
    key: "new-private-key-fixture",
    models: [],
  });
  expect(keys.cursor).toBe("new-private-key-fixture");
  expect(JSON.stringify(await setup.snapshot())).not.toContain("new-private-key-fixture");
  expect((await setup.snapshot()).apiKeys.find(({ id }) => id === "cursor")?.configured).toBe(true);
  fetcher.mockResolvedValue(new Response(null, { status: 401 }));
  await expect(
    setup.saveKey({ action: "save", provider: "cursor", key: "invalid-key-fixture", models: [] }),
  ).rejects.toThrow("provider_access");
  expect(store.read().keys.cursor).toBe("new-private-key-fixture");
  await setup.saveKey({ action: "remove", provider: "cursor" });
  expect(keys.cursor).toBeUndefined();
  expect(refresh).toHaveBeenCalledTimes(2);
  await setup.close();
});

it("imports and validates a native account key on the owner without returning it to the dashboard", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-native-key-"));
  roots.push(root);
  configureSecretStorageKey(Buffer.alloc(32, 8).toString("base64"));
  const store = new CodeShareSetupStore(join(root, "setup.enc"));
  await store.load();
  const credential = JSON.stringify({ format: "fixture-v1", key: "owner-native-fixture-secret" });
  const keys: Record<string, string | undefined> = {};
  const actions: string[] = [];
  const supervisor: Pick<SupervisorClient, "callCodeShare"> = {
    async callCodeShare<Result>(input: Parameters<SupervisorClient["callCodeShare"]>[0]) {
      actions.push(input.action);
      if (input.action === "key-import") return credential as Result;
      if (input.action === "key-catalog") {
        expect(input.key).toBe(credential);
        return [{ id: "fixture-model", label: "Fixture" }] as Result;
      }
      return [] as Result;
    },
  };
  const cloudflare = {
    async snapshot() {
      return {
        id: "cloudflare",
        label: "Cloudflare",
        connected: false,
        state: "idle",
        running: false,
        verified: false,
        publishing: false,
      };
    },
    async close() {},
  } as CodeShareCloudflareSetup;
  const setup = new CodeShareOwnerSetup(
    store,
    keys,
    supervisor,
    cloudflare,
    async () => {},
    () => [],
    () => Object.assign(keys, store.read().keys),
    async () => {
      throw new Error("REST fallback must not be used.");
    },
  );
  try {
    await setup.saveKey({ action: "import", provider: "devin" });
    expect(actions).toEqual(["key-import", "key-catalog"]);
    expect(store.read().keys.devin).toBe(credential);
    const snapshot = await setup.snapshot();
    expect(snapshot.apiKeys.find((entry) => entry.id === "devin")).toMatchObject({
      configured: true,
      importAccount: true,
      discoverModels: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("owner-native-fixture-secret");
  } finally {
    await setup.close();
  }
});
