/**
 * ViscosityCode: filesystem access for the encrypted xAI key file. The
 * directory is created owner-only (0700), the file is written atomically with
 * exact 0600 permissions, and on Windows the ACL is restricted to the current
 * user (`restrictToOwner`; POSIX modes are a no-op there).
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "@/shared/atomicFile";
import { restrictToOwner } from "@/shared/restrictToOwner";
import type { XaiKeyStoreFs } from "./xaiKeyStore";

export function createNodeXaiKeyFs(
  options: { platform?: NodeJS.Platform; restrict?: (path: string) => void } = {},
): XaiKeyStoreFs {
  const restrict =
    options.restrict ??
    ((path: string) =>
      restrictToOwner(path, options.platform ? { platform: options.platform } : {}));
  return {
    readFile: (path) => readFileSync(path),
    writeFileOwnerOnly(path, data) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileAtomic(path, data, { mode: 0o600, exactMode: true });
      try {
        restrict(path);
      } catch (error) {
        // Never leave a key file other users might read.
        rmSync(path, { force: true });
        throw error;
      }
    },
    removeFile: (path) => rmSync(path),
  };
}
