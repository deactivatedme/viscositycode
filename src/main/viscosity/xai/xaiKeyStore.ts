/**
 * ViscosityCode: where the xAI API key comes from.
 *
 * - `XAI_API_KEY` in the environment always wins.
 * - Otherwise a key the user pasted, encrypted with Electron safeStorage
 *   (Keychain / DPAPI / libsecret) at `<userData>/viscosity/xai-key.bin`,
 *   written atomically with owner-only permissions.
 * - If OS-encrypted storage is unavailable, nothing is stored (no plaintext
 *   fallback) and the user is told to use the environment variable instead.
 *
 * The key never leaves the main process: `keyStatus` reports only the source
 * and the last four characters, and nothing here logs the key.
 */
import { join } from "node:path";
import type { XaiKeyStatus } from "@/shared/viscosity/xaiContract";
import { XaiError } from "./xaiErrors";

export const XAI_KEY_DIRECTORY = "viscosity";
export const XAI_KEY_FILE_NAME = "xai-key.bin";
export const XAI_KEY_ENV_VAR = "XAI_API_KEY";

const MIN_KEY_LENGTH = 20;
const MAX_KEY_LENGTH = 512;
/** Printable ASCII without spaces: API keys are opaque tokens. */
const KEY_CHARACTERS = /^[\x21-\x7E]+$/u;
/** Show a hint only for keys long enough that four characters reveal little. */
const MIN_LENGTH_FOR_HINT = 12;

export interface XaiKeyStoreFs {
  readFile(path: string): Buffer;
  /** Atomic write with owner-only permissions (0600). */
  writeFileOwnerOnly(path: string, data: Buffer): void;
  removeFile(path: string): void;
}

export interface XaiKeyStoreDeps {
  readEnv: () => string | undefined;
  userDataDir: () => string;
  /** True only when OS-backed encryption is healthy. */
  encryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (cipher: Buffer) => string;
  fs: XaiKeyStoreFs;
  warn?: (message: string) => void;
}

export interface XaiKeyStore {
  keyStatus(): XaiKeyStatus;
  setKey(raw: unknown): XaiKeyStatus;
  clearKey(): XaiKeyStatus;
  /** Main-process only: the key to send, or undefined. Never forward this to a renderer. */
  resolveKey(): string | undefined;
}

export function xaiKeyFilePath(userDataDir: string): string {
  return join(userDataDir, XAI_KEY_DIRECTORY, XAI_KEY_FILE_NAME);
}

/** Loose format check: trims, drops a pasted `Bearer ` prefix, rejects obvious junk. */
export function normalizeXaiKey(raw: unknown): string {
  if (typeof raw !== "string") throw new XaiError("invalid-key-format");
  const key = raw.trim().replace(/^Bearer\s+/iu, "");
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH || !KEY_CHARACTERS.test(key)) {
    throw new XaiError("invalid-key-format");
  }
  return key;
}

function hintFor(key: string): string | undefined {
  return key.length >= MIN_LENGTH_FOR_HINT ? key.slice(-4) : undefined;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function createXaiKeyStore(deps: XaiKeyStoreDeps): XaiKeyStore {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  // `undefined` = not read yet; `null` = read, nothing usable stored.
  let cachedStoredKey: string | null | undefined;

  function envKey(): string | undefined {
    const value = deps.readEnv()?.trim();
    return value ? value : undefined;
  }

  function storedKey(): string | undefined {
    if (cachedStoredKey !== undefined) return cachedStoredKey ?? undefined;
    const path = xaiKeyFilePath(deps.userDataDir());
    let cipher: Buffer;
    try {
      cipher = deps.fs.readFile(path);
    } catch (error) {
      if (!isMissingFile(error)) {
        warn("[viscosity:xai] the stored xAI API key could not be read; it is ignored.");
      }
      cachedStoredKey = null;
      return undefined;
    }
    if (!deps.encryptionAvailable()) {
      cachedStoredKey = null;
      return undefined;
    }
    try {
      const key = deps.decryptString(cipher).trim();
      cachedStoredKey = key.length > 0 ? key : null;
    } catch {
      warn(
        "[viscosity:xai] the stored xAI API key could not be decrypted with this system's secure storage; it is ignored until replaced.",
      );
      cachedStoredKey = null;
    }
    return cachedStoredKey ?? undefined;
  }

  function status(): XaiKeyStatus {
    const fromEnv = envKey();
    if (fromEnv) {
      const hint = hintFor(fromEnv);
      return { configured: true, source: "env", ...(hint ? { hint } : {}) };
    }
    const fromStore = storedKey();
    if (fromStore) {
      const hint = hintFor(fromStore);
      return { configured: true, source: "stored", ...(hint ? { hint } : {}) };
    }
    return { configured: false, source: "none" };
  }

  return {
    keyStatus: status,
    resolveKey: () => envKey() ?? storedKey(),
    setKey(raw) {
      const key = normalizeXaiKey(raw);
      if (!deps.encryptionAvailable()) throw new XaiError("storage-unavailable");
      let cipher: Buffer;
      try {
        cipher = deps.encryptString(key);
      } catch {
        throw new XaiError("storage-unavailable");
      }
      try {
        deps.fs.writeFileOwnerOnly(xaiKeyFilePath(deps.userDataDir()), cipher);
      } catch {
        throw new XaiError("storage-failed");
      }
      cachedStoredKey = key;
      return status();
    },
    clearKey() {
      try {
        deps.fs.removeFile(xaiKeyFilePath(deps.userDataDir()));
      } catch (error) {
        if (!isMissingFile(error)) throw new XaiError("storage-failed");
      }
      cachedStoredKey = null;
      return status();
    },
  };
}
