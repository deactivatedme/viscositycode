import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { configureSecretStorageKey } from "@/shared/secretStorage";
import type { startManagedChildCommand } from "@/shared/managedChildCommand";
import { CodeShareSetupStore } from "./setupStore";
import { CodeShareCloudflareSetup, cloudflareLoginUrl } from "./cloudflareSetup";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const tunnelId = "11111111-2222-4333-8444-555555555555";
async function fixture(failDns = false) {
  const root = await mkdtemp(join(tmpdir(), "codeshare-cloudflare-"));
  roots.push(root);
  configureSecretStorageKey(Buffer.alloc(32, 5).toString("base64"));
  const store = new CodeShareSetupStore(join(root, "setup.enc"));
  await store.load();
  const cert = join(root, "certificate-fixture");
  await writeFile(cert, "synthetic-certificate-fixture");
  const finish = Promise.withResolvers<string>();
  const cancel = vi.fn<() => Promise<void>>(async () => {
    finish.reject(new Error("cancelled"));
  });
  const start = vi.fn<typeof startManagedChildCommand>((_binary, args) => {
    if (args.includes("create")) {
      const credentialPath = args[args.indexOf("--credentials-file") + 1]!;
      const done = writeFile(
        credentialPath,
        JSON.stringify({ TunnelID: tunnelId, TunnelSecret: "synthetic-fixture" }),
      ).then(() => JSON.stringify({ id: tunnelId }));
      return { done, cancel: async () => {} };
    }
    if (args.includes("dns"))
      return {
        done: failDns ? Promise.reject(new Error("fixture DNS refused")) : Promise.resolve(""),
        cancel: async () => {},
      };
    return { done: finish.promise, cancel };
  });
  const request = vi.fn<typeof fetch>(async () => Response.json({ nonce: "this-host-fixture" }));
  const origin = vi.fn<(value: string) => void>();
  const directory = join(root, "cloudflare");
  await mkdir(directory);
  const setup = new CodeShareCloudflareSetup(
    directory,
    17887,
    store,
    origin,
    "this-host-fixture",
    start,
    request,
    cert,
  );
  return { setup, store, start, origin, request, directory, cancel };
}

it("publishes only the guest port, refuses DNS overwrite, and verifies the exact host", async () => {
  const test = await fixture();
  try {
    await test.setup.publish("share.example.test");
    expect(test.origin).toHaveBeenCalledWith("https://share.example.test");
    const config = JSON.parse(await readFile(join(test.directory, "tunnel.json"), "utf8"));
    expect(config.ingress).toEqual([
      {
        hostname: "share.example.test",
        service: "http://127.0.0.1:17887",
        originRequest: { httpHostHeader: "share.example.test" },
      },
      { service: "http_status:404" },
    ]);
    const dns = test.start.mock.calls.find(([, args]) => args.includes("dns"));
    expect(dns?.[1]).not.toContain("--overwrite-dns");
    expect(dns?.[2].env?.TUNNEL_FORCE_PROVISIONING_DNS).toBe("false");
    expect(await test.setup.check()).toBe(true);
    test.request.mockResolvedValueOnce(Response.json({ nonce: "another-host" }));
    expect(await test.setup.check()).toBe(false);
    await test.setup.disable();
    expect(test.store.read().cloudflare?.enabled).toBe(false);
    const starts = test.start.mock.calls.length;
    await test.setup.resume();
    expect(test.start).toHaveBeenCalledTimes(starts);
    expect((await test.setup.snapshot()).running).toBe(false);
    expect(test.cancel).toHaveBeenCalledOnce();
  } finally {
    await test.setup.close();
  }
});

it("journals its tunnel before DNS and preserves that identity when DNS fails", async () => {
  const test = await fixture(true);
  try {
    await expect(test.setup.publish("share.example.test")).rejects.toThrow("DNS refused");
    expect(test.store.read().cloudflare).toEqual({
      hostname: "share.example.test",
      tunnelId,
      enabled: false,
      phase: "created",
    });
    expect(test.start.mock.calls.some(([, args]) => args.includes("run"))).toBe(false);
    expect(test.origin).not.toHaveBeenCalled();
  } finally {
    await test.setup.close();
  }
});

it("accepts only the Cloudflare account authorization origin", () => {
  expect(cloudflareLoginUrl("Open https://dash.cloudflare.com/argotunnel?token=fixture\n")).toBe(
    "https://dash.cloudflare.com/argotunnel?token=fixture",
  );
  expect(cloudflareLoginUrl("https://dash.cloudflare.com.evil.example/argotunnel")).toBeUndefined();
});

it("reuses an existing public route without creating or changing Cloudflare resources", async () => {
  const test = await fixture();
  try {
    await test.setup.useExisting("codeshare.viscosity.one");
    expect(test.start).not.toHaveBeenCalled();
    expect(test.origin).toHaveBeenCalledWith("https://codeshare.viscosity.one");
    expect((await test.setup.snapshot()).external).toBe(true);
    expect(await test.setup.check()).toBe(true);
    expect(test.request).toHaveBeenCalledWith(
      "https://codeshare.viscosity.one/.well-known/codeshare-health",
      expect.any(Object),
    );
  } finally {
    await test.setup.close();
  }
});
