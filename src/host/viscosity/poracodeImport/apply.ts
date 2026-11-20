import Database from "better-sqlite3";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveBetterSqliteNativeBindingOptions } from "@/host/db/nativeBinding";
import { patchSharedSettingsFile } from "@/host/sharedSettingsFile";
import { HOST_MINTED_THREAD_COLUMNS, type ImportPlan, type ImportTarget } from "./plan";
import { IMPORT_TABLES } from "./tablePolicy";

type Sqlite = InstanceType<typeof Database>;

const HEADS = "thread_runtime_item_stream_heads";
const HEAD_BLOCKS = "thread_runtime_item_stream_head_blocks";

const columnsOf = (sqlite: Sqlite, schema: string, table: string): string[] =>
  sqlite.prepare(`SELECT name FROM pragma_table_info(?, ?)`).pluck().all(table, schema) as string[];

/** Columns both copies have, minus the ones the target must mint itself. */
function sharedColumns(sqlite: Sqlite, table: string): string[] {
  const staged = new Set(columnsOf(sqlite, "src", table));
  const excluded = new Set(
    table === "threads"
      ? HOST_MINTED_THREAD_COLUMNS
      : table === HEADS || table === HEAD_BLOCKS
        ? ["head_id"]
        : [],
  );
  return columnsOf(sqlite, "main", table).filter(
    (column) => staged.has(column) && !excluded.has(column),
  );
}

/** One transaction: every row lands, or none does. Returns rows inserted per table. */
export function mergeStaging(targetDbPath: string, stagingDbPath: string): Record<string, number> {
  const sqlite = new Database(targetDbPath, {
    ...resolveBetterSqliteNativeBindingOptions(),
    fileMustExist: true,
    timeout: 0,
  });
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.prepare("ATTACH DATABASE ? AS src").run(stagingDbPath);
    const inserted: Record<string, number> = {};
    sqlite.prepare("BEGIN IMMEDIATE").run();
    try {
      for (const table of IMPORT_TABLES) {
        const columns = sharedColumns(sqlite, table.name).map((column) => `"${column}"`);
        if (table.name === HEAD_BLOCKS) {
          // head_id is an INTEGER key local to each database: resolve it through
          // the heads' (thread_id, item_id, stream_key) identity.
          const result = sqlite
            .prepare(
              `INSERT INTO main."${HEAD_BLOCKS}" (head_id, ${columns.join(", ")})
               SELECT mh.head_id, ${columns.map((column) => `b.${column}`).join(", ")}
               FROM src."${HEAD_BLOCKS}" b
               JOIN src."${HEADS}" sh ON sh.head_id = b.head_id
               JOIN main."${HEADS}" mh ON mh.thread_id = sh.thread_id
                 AND mh.item_id = sh.item_id AND mh.stream_key = sh.stream_key`,
            )
            .run();
          const staged = (
            sqlite.prepare(`SELECT count(*) AS n FROM src."${HEAD_BLOCKS}"`).get() as { n: number }
          ).n;
          if (result.changes !== staged) {
            throw new Error(
              `Only ${result.changes} of ${staged} stream head blocks found their head.`,
            );
          }
          inserted[table.name] = result.changes;
          continue;
        }
        const conflict = table.keepExisting
          ? ` ON CONFLICT(${table.keepExisting.join(", ")}) DO NOTHING`
          : "";
        inserted[table.name] = sqlite
          .prepare(
            `INSERT INTO main."${table.name}" (${columns.join(", ")})
             SELECT ${columns.join(", ")} FROM src."${table.name}" WHERE true${conflict}`,
          )
          .run().changes;
      }
      for (const table of IMPORT_TABLES) {
        const problems = sqlite.pragma(`main.foreign_key_check("${table.name}")`) as unknown[];
        if (problems.length > 0) {
          throw new Error(`Foreign key check failed for ${table.name}; nothing was imported.`);
        }
      }
      sqlite.prepare("COMMIT").run();
    } catch (error) {
      if (sqlite.inTransaction) sqlite.prepare("ROLLBACK").run();
      throw error;
    }
    if (sqlite.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error("The ViscosityCode database failed its integrity check after the import.");
    }
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    return inserted;
  } finally {
    sqlite.close();
  }
}

/**
 * Write the plan into the target: back up its database and settings, copy the
 * attachment folders (never overwriting), merge rows, then add workspaces.
 */
export async function applyImport(options: {
  plan: ImportPlan;
  stagingDbPath: string;
  sourceRoot: string;
  target: ImportTarget;
  backupDir: string;
}): Promise<Record<string, number>> {
  const { plan, target, backupDir } = options;
  mkdirSync(backupDir, { recursive: false, mode: 0o700 });
  const backupSource = new Database(target.dbPath, {
    ...resolveBetterSqliteNativeBindingOptions(),
    fileMustExist: true,
    readonly: true,
  });
  try {
    await backupSource.backup(join(backupDir, "state.sqlite"));
  } finally {
    backupSource.close();
  }
  if (existsSync(target.settingsPath)) {
    copyFileSync(target.settingsPath, join(backupDir, "settings.json"));
  }
  // Copied before the database commit: a folder without rows is harmless and reclaimed.
  for (const name of plan.attachmentFolders) {
    cpSync(
      join(options.sourceRoot, "attachments", name),
      join(target.dataRoot, "attachments", name),
      {
        recursive: true,
        force: false,
        errorOnExist: false,
      },
    );
  }
  const inserted = mergeStaging(target.dbPath, options.stagingDbPath);
  if (plan.nextWorkspaces) {
    patchSharedSettingsFile(target.settingsPath, { workspaces: [...plan.nextWorkspaces] });
  }
  return inserted;
}
