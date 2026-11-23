import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { configureSecretStorageKey, encryptSecret } from "@/shared/secretStorage";
import { CodeShareSetupStore } from "./setupStore";
import { loadCodeShareSetupKey } from "./setupKey";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codeshare-setup-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("upgrades an environment-only setup without overwriting its grants, and seals keys across restarts", async () => {
  const root = await fixture();
  await writeFile(join(root, "codeshare.sqlite"), "previous-grants-fixture");
  const key = await loadCodeShareSetupKey(root);
  configureSecretStorageKey(key);
  const path = join(root, "setup.enc");
  const store = new CodeShareSetupStore(path);
  await store.load();
  expect(store.read()).toEqual({ version: 1, keys: {}, models: {} });
  await store.update((current) => ({
    ...current,
    keys: { cursor: "private-fixture-key" },
    models: { cursor: [] },
  }));
  expect(await readFile(path, "utf8")).not.toContain("private-fixture-key");
  expect(await loadCodeShareSetupKey(root)).toBe(key);
  const next = new CodeShareSetupStore(path);
  await next.load();
  expect(next.read().keys.cursor).toBe("private-fixture-key");
  expect(await readFile(join(root, "codeshare.sqlite"), "utf8")).toBe("previous-grants-fixture");
});

it("preserves unknown future encrypted setup and key versions", async () => {
  const root = await fixture();
  configureSecretStorageKey(Buffer.alloc(32, 4).toString("base64"));
  const path = join(root, "setup.enc");
  const bytes = encryptSecret("", JSON.stringify({ version: 99, keys: {}, models: {} }));
  await writeFile(path, bytes);
  await expect(new CodeShareSetupStore(path).load()).rejects.toThrow("Invalid");
  expect(await readFile(path, "utf8")).toBe(bytes);
  const futureKey = JSON.stringify({ version: 99, key: Buffer.alloc(32, 4).toString("base64") });
  await writeFile(join(root, "setup-key.json"), futureKey);
  await expect(loadCodeShareSetupKey(root)).rejects.toThrow("Invalid");
  expect(await readFile(join(root, "setup-key.json"), "utf8")).toBe(futureKey);
});

it.runIf(process.platform !== "win32")(
  "restricts the encrypted setup file to its owner",
  async () => {
    const root = await fixture();
    configureSecretStorageKey(Buffer.alloc(32, 4).toString("base64"));
    const path = join(root, "setup.enc");
    const store = new CodeShareSetupStore(path);
    await store.load();
    await store.update((current) => current);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  },
);

it("never creates a replacement key beside existing encrypted credentials", async () => {
  const root = await fixture();
  const ciphertext = "existing-encrypted-setup-fixture";
  await writeFile(join(root, "setup.enc"), ciphertext);
  await expect(loadCodeShareSetupKey(root)).rejects.toThrow("setup key is missing");
  await expect(stat(join(root, "setup-key.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(root, "setup.enc"), "utf8")).toBe(ciphertext);
});
