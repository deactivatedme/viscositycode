import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHostRootManifest } from "@/backend/ownership/hostRootManifest";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { closeDatabase, initDatabase } from "@/host/db/connection";
import { LATEST_SCHEMA_VERSION } from "@/host/db/migrations";
import { resolveBetterSqliteNativeBindingOptions } from "@/host/db/nativeBinding";

const DB_FILES = ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm"] as const;

export interface SourceSnapshot {
  readonly sourceRoot: string;
  readonly stagingDir: string;
  readonly stagingDbPath: string;
  readonly sourceSchemaVersion: number;
}

/** Deletes the staging copy without ever hiding the import's outcome (Windows scanners can briefly lock a fresh file). */
export function removeStagingDir(stagingDir: string): void {
  try {
    rmSync(stagingDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`Could not delete the temporary copy ${stagingDir}:`, error);
  }
}

/** Prefer an activated `<from>.host-v1` (a Poracode with the unified root), else `<from>`. */
export function resolveSourceRoot(from: string): string {
  try {
    const paths = resolveHostRootPaths(from);
    const manifest = readHostRootManifest(paths);
    if (manifest?.source.activation === "ready" && existsSync(join(paths.dataRoot, DB_FILES[0]))) {
      return paths.dataRoot;
    }
  } catch {
    // `from` is itself a data root or has no owned sibling.
  }
  return from;
}

function fileStamp(path: string): string {
  try {
    const info = statSync(path);
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    return "missing";
  }
}

/** A clean quit folds the WAL back into the database; a non-empty WAL means Poracode is running or crashed. */
export function assertSourceOffline(sourceRoot: string): void {
  if (!existsSync(join(sourceRoot, DB_FILES[0]))) {
    throw new Error(`No Poracode database at ${join(sourceRoot, DB_FILES[0])}.`);
  }
  const wal = join(sourceRoot, DB_FILES[1]);
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error(
      "Quit Poracode first: its database has unsaved changes (a non-empty state.sqlite-wal). " +
        "If Poracode is not running, open it once and quit it normally.",
    );
  }
}

/** Copy the source database into a private folder and migrate only the copy. The source is only read. */
export function snapshotSource(sourceRoot: string): SourceSnapshot {
  assertSourceOffline(sourceRoot);
  const before = DB_FILES.map((name) => fileStamp(join(sourceRoot, name)));
  const stagingDir = mkdtempSync(join(tmpdir(), "viscosity-poracode-import-"));
  try {
    for (const name of DB_FILES) {
      if (existsSync(join(sourceRoot, name))) {
        copyFileSync(join(sourceRoot, name), join(stagingDir, name));
      }
    }
    const after = DB_FILES.map((name) => fileStamp(join(sourceRoot, name)));
    if (after.join() !== before.join()) {
      throw new Error("Poracode changed its database during the copy. Quit Poracode and retry.");
    }
    const stagingDbPath = join(stagingDir, DB_FILES[0]);
    const raw = new Database(stagingDbPath, {
      ...resolveBetterSqliteNativeBindingOptions(),
      fileMustExist: true,
    });
    let sourceSchemaVersion: number;
    try {
      const row = raw.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined;
      sourceSchemaVersion = Number(row?.value ?? 0);
    } finally {
      raw.close();
    }
    if (!Number.isInteger(sourceSchemaVersion) || sourceSchemaVersion <= 0) {
      throw new Error("The source is not a Poracode database (no schema version).");
    }
    if (sourceSchemaVersion > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Poracode's database (schema ${sourceSchemaVersion}) is newer than this ViscosityCode ` +
          `(schema ${LATEST_SCHEMA_VERSION}). Update ViscosityCode first.`,
      );
    }
    initDatabase(stagingDbPath);
    closeDatabase();
    return { sourceRoot, stagingDir, stagingDbPath, sourceSchemaVersion };
  } catch (error) {
    closeDatabase();
    removeStagingDir(stagingDir);
    throw error;
  }
}
