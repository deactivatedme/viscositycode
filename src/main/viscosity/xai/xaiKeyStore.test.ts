import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeXaiKeyFs } from "./xaiKeyFs";
import {
  createXaiKeyStore,
  normalizeXaiKey,
  xaiKeyFilePath,
  type XaiKeyStoreDeps,
  type XaiKeyStoreFs,
} from "./xaiKeyStore";

const STORED_KEY = "xai-storedKEY0123456789abcdefWXYZ";
const ENV_KEY = "xai-envKEY9876543210zyxwvuENV1";
const USER_DATA = "/fake/userData";

/** In-memory fs + a reversible fake of Electron safeStorage. */
function harness(overrides: Partial<XaiKeyStoreDeps> = {}) {
  const files = new Map<string, Buffer>();
  const fs: XaiKeyStoreFs = {
    readFile: vi.fn<(path: string) => Buffer>((path) => {
      const data = files.get(path);
      if (!data) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return data;
    }),
    writeFileOwnerOnly: vi.fn<(path: string, data: Buffer) => void>((path, data) => {
      files.set(path, data);
    }),
    removeFile: vi.fn<(path: string) => void>((path) => {
      if (!files.delete(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
  };
  const safeStorage = {
    encryptionAvailable: vi.fn<() => boolean>(() => true),
    encryptString: vi.fn<(plain: string) => Buffer>((plain) =>
      Buffer.from(`sealed:${Buffer.from(plain).toString("base64")}`),
    ),
    decryptString: vi.fn<(cipher: Buffer) => string>((cipher) => {
      const text = cipher.toString();
      if (!text.startsWith("sealed:")) throw new Error("decrypt failed");
      return Buffer.from(text.slice("sealed:".length), "base64").toString();
    }),
  };
  let env: string | undefined;
  const warn = vi.fn<(message: string) => void>();
  const deps: XaiKeyStoreDeps = {
    readEnv: () => env,
    userDataDir: () => USER_DATA,
    ...safeStorage,
    fs,
    warn,
    ...overrides,
  };
  return {
    files,
    fs,
    safeStorage,
    warn,
    deps,
    setEnv(value: string | undefined) {
      env = value;
    },
    store: () => createXaiKeyStore(deps),
  };
}

describe("xAI key store", () => {
  it("stores the key encrypted at <userData>/viscosity/xai-key.bin", () => {
    const h = harness();
    const status = h.store().setKey(STORED_KEY);
    expect(status).toEqual({ configured: true, source: "stored", hint: "WXYZ" });
    const path = join(USER_DATA, "viscosity", "xai-key.bin");
    expect(xaiKeyFilePath(USER_DATA)).toBe(path);
    const written = h.files.get(path);
    expect(written).toBeDefined();
    expect(written?.toString()).not.toContain(STORED_KEY);
    expect(h.safeStorage.encryptString).toHaveBeenCalledWith(STORED_KEY);
  });

  it("reads and decrypts the stored key in a fresh process", () => {
    const h = harness();
    h.store().setKey(STORED_KEY);
    const fresh = h.store();
    expect(fresh.resolveKey()).toBe(STORED_KEY);
    expect(fresh.keyStatus()).toEqual({ configured: true, source: "stored", hint: "WXYZ" });
  });

  it("lets XAI_API_KEY win over a stored key", () => {
    const h = harness();
    h.store().setKey(STORED_KEY);
    h.setEnv(`  ${ENV_KEY}  `);
    const store = h.store();
    expect(store.resolveKey()).toBe(ENV_KEY);
    expect(store.keyStatus()).toEqual({ configured: true, source: "env", hint: "ENV1" });
    // Storing while the env var is set still reports the env source.
    expect(store.setKey(STORED_KEY).source).toBe("env");
  });

  it("ignores a blank XAI_API_KEY", () => {
    const h = harness();
    h.setEnv("   ");
    expect(h.store().keyStatus()).toEqual({ configured: false, source: "none" });
  });

  it("never returns or logs the key: status carries only the last four characters", () => {
    const h = harness();
    const store = h.store();
    const statuses = [store.setKey(STORED_KEY), store.keyStatus()];
    h.setEnv(ENV_KEY);
    statuses.push(store.keyStatus());
    for (const status of statuses) {
      const json = JSON.stringify(status);
      expect(json).not.toContain(STORED_KEY.slice(0, -4));
      expect(json).not.toContain(ENV_KEY.slice(0, -4));
      expect(Object.keys(status).sort()).toEqual(["configured", "hint", "source"]);
      expect(status.hint).toHaveLength(4);
    }
    for (const call of h.warn.mock.calls) expect(call.join(" ")).not.toContain(STORED_KEY);
  });

  it("omits the hint for very short env keys", () => {
    const h = harness();
    h.setEnv("short-key");
    expect(h.store().keyStatus()).toEqual({ configured: true, source: "env" });
  });

  it("refuses to store when OS encryption is unavailable, and writes nothing", () => {
    const h = harness();
    h.safeStorage.encryptionAvailable.mockReturnValue(false);
    expect(() => h.store().setKey(STORED_KEY)).toThrow(
      expect.objectContaining({ code: "storage-unavailable" }),
    );
    expect(h.fs.writeFileOwnerOnly).not.toHaveBeenCalled();
    expect(h.safeStorage.encryptString).not.toHaveBeenCalled();
  });

  it("refuses when encryption throws", () => {
    const h = harness();
    h.safeStorage.encryptString.mockImplementation(() => {
      throw new Error("keychain locked");
    });
    expect(() => h.store().setKey(STORED_KEY)).toThrow(
      expect.objectContaining({ code: "storage-unavailable" }),
    );
    expect(h.fs.writeFileOwnerOnly).not.toHaveBeenCalled();
  });

  it("reports storage-failed when the file cannot be written", () => {
    const h = harness();
    vi.mocked(h.fs.writeFileOwnerOnly).mockImplementation(() => {
      throw new Error("EACCES");
    });
    const store = h.store();
    expect(() => store.setKey(STORED_KEY)).toThrow(
      expect.objectContaining({ code: "storage-failed" }),
    );
    expect(store.keyStatus().configured).toBe(false);
  });

  it("validates the key format loosely", () => {
    expect(normalizeXaiKey(`  Bearer ${STORED_KEY}\n`)).toBe(STORED_KEY);
    expect(normalizeXaiKey("A".repeat(20))).toBe("A".repeat(20));
    for (const bad of [
      "",
      "too-short",
      "xai-has space inside the key",
      "x".repeat(600),
      42,
      null,
    ]) {
      expect(() => normalizeXaiKey(bad)).toThrow(
        expect.objectContaining({ code: "invalid-key-format" }),
      );
    }
  });

  it("clearKey deletes the file and falls back to the environment", () => {
    const h = harness();
    const store = h.store();
    store.setKey(STORED_KEY);
    expect(store.clearKey()).toEqual({ configured: false, source: "none" });
    expect(h.files.size).toBe(0);
    expect(store.resolveKey()).toBeUndefined();
    // Clearing again (no file) is fine.
    expect(store.clearKey()).toEqual({ configured: false, source: "none" });
    h.setEnv(ENV_KEY);
    expect(store.clearKey().source).toBe("env");
  });

  it("treats an undecryptable stored key as missing and warns without leaking", () => {
    const h = harness();
    h.files.set(xaiKeyFilePath(USER_DATA), Buffer.from("garbage-from-another-machine"));
    const store = h.store();
    expect(store.keyStatus()).toEqual({ configured: false, source: "none" });
    expect(store.resolveKey()).toBeUndefined();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).not.toContain("garbage");
  });

  it("does not decrypt a stored key while OS encryption is unavailable", () => {
    const h = harness();
    h.store().setKey(STORED_KEY);
    h.safeStorage.encryptionAvailable.mockReturnValue(false);
    expect(h.store().keyStatus()).toEqual({ configured: false, source: "none" });
    expect(h.safeStorage.decryptString).not.toHaveBeenCalled();
  });
});

describe("node key file access", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "viscosity-xai-key-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")(
    "writes the key file 0600 inside a 0700 directory",
    () => {
      const restrict = vi.fn<(path: string) => void>();
      const fs = createNodeXaiKeyFs({ restrict });
      const path = xaiKeyFilePath(root);
      fs.writeFileOwnerOnly(path, Buffer.from("cipher"));
      expect(readFileSync(path).toString()).toBe("cipher");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(root, "viscosity")).mode & 0o777).toBe(0o700);
      expect(restrict).toHaveBeenCalledWith(path);
      fs.removeFile(path);
      expect(existsSync(path)).toBe(false);
      expect(() => fs.removeFile(path)).toThrow(expect.objectContaining({ code: "ENOENT" }));
    },
  );

  it("removes the file when the owner-only ACL cannot be applied", () => {
    const fs = createNodeXaiKeyFs({
      restrict: () => {
        throw new Error("icacls failed");
      },
    });
    const path = xaiKeyFilePath(root);
    expect(() => fs.writeFileOwnerOnly(path, Buffer.from("cipher"))).toThrow("icacls failed");
    expect(existsSync(path)).toBe(false);
  });
});
