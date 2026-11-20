import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { getThreadAttachmentDirName } from "@/host/attachments/attachmentStorage";
import { resolveBetterSqliteNativeBindingOptions } from "@/host/db/nativeBinding";
import { type ProjectRow, rowToLocation } from "@/host/db/rowMappers";
import { readSharedSettingsFile } from "@/host/sharedSettingsFile";
import type { Workspace } from "@/shared/contracts";
import { projectIdentityKey } from "@/shared/projectIdentity";
import { classifyTables, IMPORT_TABLES, SKIP_TABLES } from "./tablePolicy";

type Sqlite = InstanceType<typeof Database>;

export interface ImportTarget {
  readonly dbPath: string;
  readonly dataRoot: string;
  readonly settingsPath: string;
}

export interface ImportReport {
  sourceRoot: string;
  sourceSchemaVersion: number;
  stagingBytes: number;
  targetDataRoot: string;
  projects: { source: number; folded: number; added: number; renamedIds: number };
  threads: {
    source: number;
    alreadyPresent: number;
    added: number;
    byAgentKind: Record<string, number>;
    byPresentation: Record<string, number>;
    archived: number;
    withAgentInstance: number;
    droppedWorkspaceGrants: number;
  };
  /** Rows each imported table will receive (existing ViscosityCode rows win). */
  rows: Record<string, number>;
  /** Rows left behind, by table, with the reason. */
  skipped: Record<string, { rows: number; reason: string }>;
  workspaces: { mapped: number; added: string[] };
  attachments: { folders: number; files: number; bytes: number };
  rewrittenPaths: number;
}

export interface ImportPlan {
  readonly report: ImportReport;
  /** Attachment folder names under `<source>/attachments` to copy. */
  readonly attachmentFolders: readonly string[];
  /** Full workspace list to write when workspaces were added, else undefined. */
  readonly nextWorkspaces: readonly Workspace[] | undefined;
}

/** Columns a host mints itself; the target's insert trigger refuses copied values. */
export const HOST_MINTED_THREAD_COLUMNS = [
  "additional_directories",
  "workspace_grant_revision",
  "workspace_owner_incarnation",
  "workspace_grants_initialized",
];

const jsonEscaped = (value: string) => JSON.stringify(value).slice(1, -1);
const count = (sqlite: Sqlite, sql: string, ...params: unknown[]) =>
  (sqlite.prepare(sql).get(...params) as { n: number }).n;
const normalizedName = (name: string) => name.trim().toLocaleLowerCase();

function attachmentPrefixes(roots: readonly string[]): string[] {
  const all = new Set<string>();
  for (const root of roots) {
    all.add(root);
    try {
      all.add(realpathSync.native(root));
    } catch {
      // Missing roots keep their literal spelling only.
    }
  }
  return [...all].map((root) => jsonEscaped(join(root, "attachments") + sep));
}

function folderSize(path: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += statSync(join(entry.parentPath, entry.name)).size;
  }
  return { files, bytes };
}

function readSettingsWorkspaces(settingsPath: string): Workspace[] {
  if (!existsSync(settingsPath)) return [];
  // readSharedSettingsFile falls back to defaults on a damaged file; never write over one.
  JSON.parse(readFileSync(settingsPath, "utf8"));
  return readSharedSettingsFile(settingsPath).workspaces;
}

function planWorkspaces(
  source: readonly Workspace[],
  target: readonly Workspace[],
): { idMap: Map<string, string>; added: Workspace[] } {
  const idMap = new Map<string, string>();
  const added: Workspace[] = [];
  const targetIds = new Set(target.map((workspace) => workspace.id));
  for (const workspace of source) {
    const match = target.find(
      (candidate) => normalizedName(candidate.name) === normalizedName(workspace.name),
    );
    if (match) {
      idMap.set(workspace.id, match.id);
      continue;
    }
    const id = targetIds.has(workspace.id) ? randomUUID() : workspace.id;
    idMap.set(workspace.id, id);
    added.push({ ...workspace, id });
  }
  return { idMap, added };
}

/**
 * Fold matched projects into the target's, and re-id unrelated id collisions.
 * Every id is decided before any row moves: a fold can target an id that a
 * later source project vacates, so sequential moves would depend on row order.
 */
function planProjects(sqlite: Sqlite): { source: number; folded: number; renamedIds: number } {
  const identity = { caseInsensitivePosix: process.platform === "darwin" };
  const keyOf = (row: ProjectRow) =>
    projectIdentityKey({ id: row.id, location: rowToLocation(row) }, identity);
  const targetRows = sqlite.prepare("SELECT * FROM tgt.projects").all() as ProjectRow[];
  const targetByKey = new Map<string, string>();
  const targetById = new Map<string, string>();
  for (const row of targetRows) {
    const key = keyOf(row);
    targetById.set(row.id, key);
    if (!targetByKey.has(key)) targetByKey.set(key, row.id);
  }
  const sourceRows = sqlite.prepare("SELECT * FROM main.projects").all() as ProjectRow[];
  sqlite.prepare("CREATE TEMP TABLE project_map (src TEXT PRIMARY KEY, dst TEXT NOT NULL)").run();
  const insert = sqlite.prepare("INSERT INTO project_map VALUES (?, ?)");
  let folded = 0;
  let renamedIds = 0;
  for (const row of sourceRows) {
    const key = keyOf(row);
    // Prefer the same id when the target holds duplicates of one location.
    const match = targetById.get(row.id) === key ? row.id : targetByKey.get(key);
    if (match) {
      folded += 1;
      insert.run(row.id, match);
    } else if (targetById.has(row.id)) {
      renamedIds += 1;
      insert.run(row.id, randomUUID());
    }
  }
  for (const sql of [
    `UPDATE main.threads SET project_id = (SELECT dst FROM project_map WHERE src = project_id)
     WHERE project_id IN (SELECT src FROM project_map)`,
    // Notes are keyed by project: park them on unique ids first so no note collides
    // with one still waiting to move; a second note folding onto one id is dropped.
    `UPDATE main.project_notes SET project_id = 'poracode-import:' || project_id
     WHERE project_id IN (SELECT src FROM project_map)`,
    `UPDATE OR IGNORE main.project_notes
     SET project_id = (SELECT dst FROM project_map WHERE 'poracode-import:' || src = project_id)
     WHERE project_id LIKE 'poracode-import:%'`,
    "DELETE FROM main.project_notes WHERE project_id LIKE 'poracode-import:%'",
    // Folds land on target ids; renames land on fresh ids no target row has.
    "DELETE FROM main.projects WHERE id IN (SELECT src FROM project_map WHERE dst IN (SELECT id FROM tgt.projects))",
    `UPDATE main.projects SET id = (SELECT dst FROM project_map WHERE src = id)
     WHERE id IN (SELECT src FROM project_map)`,
  ]) {
    sqlite.prepare(sql).run();
  }
  sqlite
    .prepare(
      "UPDATE main.projects SET sort_order = sort_order + (SELECT coalesce(max(sort_order), -1) + 1 FROM tgt.projects)",
    )
    .run();
  return { source: sourceRows.length, folded, renamedIds };
}

/**
 * Collect the attachment folders the kept rows need, then point those rows at
 * the target. Only thread config and item payloads are rewritten, never stream
 * text, whose stored character counts would stop matching.
 */
function planAttachments(
  sqlite: Sqlite,
  sourceRoot: string,
  aliases: readonly string[],
  targetDataRoot: string,
): { folders: string[]; rewrittenPaths: number } {
  const newPrefix = jsonEscaped(join(targetDataRoot, "attachments") + sep);
  const folders = new Set(
    (sqlite.prepare("SELECT id FROM threads").pluck().all() as string[]).map(
      getThreadAttachmentDirName,
    ),
  );
  let rewrittenPaths = 0;
  for (const prefix of attachmentPrefixes([sourceRoot, ...aliases])) {
    if (prefix === newPrefix) continue;
    const texts = sqlite
      .prepare(
        `SELECT payload FROM thread_runtime_items WHERE instr(payload, @prefix) > 0
         UNION ALL SELECT config FROM threads WHERE instr(config, @prefix) > 0`,
      )
      .pluck()
      .all({ prefix }) as string[];
    // A sent draft keeps its draft-* folder, so referenced folders are copied too.
    for (const text of texts) {
      for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, at + 1)) {
        const name = /^[^/\\"]+/u.exec(text.slice(at + prefix.length))?.[0];
        if (name && name !== "." && name !== "..") folders.add(name);
      }
    }
    for (const [table, column] of [
      ["threads", "config"],
      ["thread_runtime_items", "payload"],
    ] as const) {
      rewrittenPaths += sqlite
        .prepare(
          `UPDATE main.${table} SET ${column} = replace(${column}, @prefix, @next) WHERE instr(${column}, @prefix) > 0`,
        )
        .run({ prefix, next: newPrefix }).changes;
    }
  }
  const attachmentsRoot = join(sourceRoot, "attachments");
  const existing = [...folders].filter((name) => {
    try {
      return statSync(join(attachmentsRoot, name)).isDirectory();
    } catch {
      return false;
    }
  });
  return { folders: existing.toSorted(), rewrittenPaths };
}

/**
 * Reshape the private staging copy into exactly the rows the merge will copy and
 * report them. The target is only read; nothing outside staging changes.
 */
export function planImport(options: {
  stagingDbPath: string;
  sourceRoot: string;
  /** Extra spellings of the source root that old attachment paths may use. */
  sourceAliases?: readonly string[];
  sourceSchemaVersion: number;
  target: ImportTarget;
}): ImportPlan {
  const { stagingDbPath, sourceRoot, target } = options;
  const sqlite = new Database(stagingDbPath, {
    ...resolveBetterSqliteNativeBindingOptions(),
    fileMustExist: true,
  });
  const run = (sql: string) => sqlite.prepare(sql).run();
  // The last connection to close a WAL database checkpoints it and deletes the
  // -wal and -shm files. A read-only connection never does, so when the target
  // has a leftover WAL (after a crash), one holds the target until staging closes.
  // Without a WAL it is skipped: it would leave the empty files staging created.
  let targetGuard: Sqlite | undefined;
  try {
    if (existsSync(`${target.dbPath}-wal`)) {
      targetGuard = new Database(target.dbPath, {
        ...resolveBetterSqliteNativeBindingOptions(),
        fileMustExist: true,
        readonly: true,
      });
      targetGuard.prepare("SELECT count(*) FROM sqlite_master").get();
    }
    // Plain ATTACH (better-sqlite3 has no URI filenames for mode=ro). Every
    // write below names `main`; the lease keeps other writers out.
    sqlite.prepare("ATTACH DATABASE ? AS tgt").run(target.dbPath);
    classifyTables(sqlite, "main");
    classifyTables(sqlite, "tgt");
    // Staging is a disposable copy: its own triggers (grant custody, search
    // queue, history revisions) must not fire while it is reshaped.
    for (const name of sqlite
      .prepare("SELECT name FROM main.sqlite_master WHERE type = 'trigger'")
      .pluck()
      .all() as string[]) {
      run(`DROP TRIGGER main."${name}"`);
    }
    const skipped: ImportReport["skipped"] = {};
    for (const [name, reason] of Object.entries(SKIP_TABLES)) {
      if (name.startsWith("conversation_search")) continue;
      const rows = count(sqlite, `SELECT count(*) AS n FROM main."${name}"`);
      if (rows > 0) skipped[name] = { rows, reason };
    }
    run("DELETE FROM main.thread_workspace_grant_operations");

    const sourceThreads = count(sqlite, "SELECT count(*) AS n FROM threads");
    const alreadyPresent = count(
      sqlite,
      "SELECT count(*) AS n FROM threads WHERE id IN (SELECT id FROM tgt.threads)",
    );
    // A thread already in ViscosityCode is skipped with all its child rows.
    sqlite.pragma("foreign_keys = ON");
    run("DELETE FROM main.threads WHERE id IN (SELECT id FROM tgt.threads)");
    sqlite.pragma("foreign_keys = OFF");

    const projects = planProjects(sqlite);

    const targetWorkspaces = readSettingsWorkspaces(target.settingsPath);
    const workspaces = planWorkspaces(
      readSettingsWorkspaces(join(sourceRoot, "settings.json")),
      targetWorkspaces,
    );
    run("CREATE TEMP TABLE workspace_map (src TEXT PRIMARY KEY, dst TEXT NOT NULL)");
    for (const [src, dst] of workspaces.idMap) {
      sqlite.prepare("INSERT INTO workspace_map VALUES (?, ?)").run(src, dst);
    }
    for (const table of ["projects", "threads"]) {
      run(
        `UPDATE main.${table} SET workspace_id = (SELECT dst FROM workspace_map WHERE src = workspace_id)
         WHERE workspace_id IN (SELECT src FROM workspace_map)`,
      );
    }

    const { folders, rewrittenPaths } = planAttachments(
      sqlite,
      sourceRoot,
      options.sourceAliases ?? [],
      target.dataRoot,
    );
    const attachments = { folders: folders.length, files: 0, bytes: 0 };
    for (const name of folders) {
      const size = folderSize(join(sourceRoot, "attachments", name));
      attachments.files += size.files;
      attachments.bytes += size.bytes;
    }

    // Only blobs a kept image reference needs.
    run(
      "DELETE FROM main.runtime_inline_image_blobs WHERE blob_hash NOT IN (SELECT blob_hash FROM thread_runtime_item_image_refs)",
    );

    const rows: Record<string, number> = {};
    for (const table of IMPORT_TABLES) {
      const key = table.keepExisting;
      rows[table.name] = key
        ? count(
            sqlite,
            `SELECT count(*) AS n FROM main."${table.name}" s WHERE NOT EXISTS (
               SELECT 1 FROM tgt."${table.name}" t
               WHERE ${key.map((column) => `t."${column}" = s."${column}"`).join(" AND ")})`,
          )
        : count(sqlite, `SELECT count(*) AS n FROM main."${table.name}"`);
    }
    const tally = (column: string) =>
      Object.fromEntries(
        (
          sqlite
            .prepare(`SELECT ${column} AS k, count(*) AS n FROM threads GROUP BY ${column}`)
            .all() as { k: string; n: number }[]
        ).map((row) => [row.k, row.n]),
      );
    const report: ImportReport = {
      sourceRoot,
      sourceSchemaVersion: options.sourceSchemaVersion,
      stagingBytes: statSync(stagingDbPath).size,
      targetDataRoot: target.dataRoot,
      projects: { ...projects, added: rows.projects ?? 0 },
      threads: {
        source: sourceThreads,
        alreadyPresent,
        added: rows.threads ?? 0,
        byAgentKind: tally("agent_kind"),
        byPresentation: tally("presentation_mode"),
        archived: count(sqlite, "SELECT count(*) AS n FROM threads WHERE archived != 0"),
        withAgentInstance: count(
          sqlite,
          "SELECT count(*) AS n FROM threads WHERE agent_instance_id IS NOT NULL",
        ),
        droppedWorkspaceGrants: count(
          sqlite,
          "SELECT count(*) AS n FROM threads WHERE additional_directories != '[]'",
        ),
      },
      rows,
      skipped,
      workspaces: {
        mapped: workspaces.idMap.size - workspaces.added.length,
        added: workspaces.added.map((workspace) => workspace.name),
      },
      attachments,
      rewrittenPaths,
    };
    return {
      report,
      attachmentFolders: folders,
      nextWorkspaces:
        workspaces.added.length > 0 ? [...targetWorkspaces, ...workspaces.added] : undefined,
    };
  } finally {
    sqlite.close();
    targetGuard?.close();
  }
}
