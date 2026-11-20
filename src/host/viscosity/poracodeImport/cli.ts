import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostDataFence, HostDataFenceInUseError } from "@/backend/ownership/hostDataFence";
import { HostOwnerLease, HostRootInUseError } from "@/backend/ownership/hostOwnerLease";
import { inspectOwnedHostRootAdmission } from "@/backend/ownership/hostRootManifest";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { LATEST_SCHEMA_VERSION } from "@/host/db/migrations";
import { resolveBetterSqliteNativeBindingOptions } from "@/host/db/nativeBinding";
import { userDataDirNameFor } from "@/shared/channel";
import { applyImport } from "./apply";
import { type ImportReport, planImport } from "./plan";
import { removeStagingDir, resolveSourceRoot, snapshotSource } from "./sourceSnapshot";

export interface ImportOptions {
  readonly from: string;
  /** ViscosityCode profile namespace (the owned root is `<to>.host-v1`). */
  readonly to: string;
  readonly apply: boolean;
}

export interface ImportResult {
  readonly report: ImportReport;
  readonly inserted?: Record<string, number>;
  readonly backupDir?: string;
}

function readSchemaVersion(dbPath: string): number {
  const sqlite = new Database(dbPath, {
    ...resolveBetterSqliteNativeBindingOptions(),
    fileMustExist: true,
    readonly: true,
  });
  try {
    const row = sqlite.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    return Number(row?.value ?? 0);
  } finally {
    sqlite.close();
  }
}

/** Dry run unless `apply`. Holds the target's owner lease and data fence throughout. */
export async function runPoracodeImport(options: ImportOptions): Promise<ImportResult> {
  const paths = resolveHostRootPaths(options.to);
  const inUse = () => new Error(`Quit ViscosityCode first: it is using ${paths.dataRoot}.`);
  let lease: HostOwnerLease;
  try {
    lease = HostOwnerLease.acquire(paths, "desktop");
  } catch (error) {
    throw error instanceof HostRootInUseError ? inUse() : error;
  }
  let fence: HostDataFence | undefined;
  let stagingDir: string | undefined;
  try {
    try {
      fence = HostDataFence.acquire(paths.dataFencePath);
    } catch (error) {
      throw error instanceof HostDataFenceInUseError ? inUse() : error;
    }
    const manifest = inspectOwnedHostRootAdmission(paths, { allowNonCustodialNamespace: true });
    const target = {
      dbPath: join(paths.dataRoot, "state.sqlite"),
      dataRoot: paths.dataRoot,
      settingsPath: join(paths.dataRoot, "settings.json"),
    };
    if (!manifest || !existsSync(target.dbPath)) {
      throw new Error(
        `ViscosityCode has no data at ${paths.dataRoot} yet. Open ViscosityCode once, quit it, and retry.`,
      );
    }
    // Never migrate the target: a newer schema would make the installed app refuse its own data.
    const targetSchema = readSchemaVersion(target.dbPath);
    if (targetSchema !== LATEST_SCHEMA_VERSION) {
      throw new Error(
        `ViscosityCode's database is at schema ${targetSchema}, but this importer expects ` +
          `${LATEST_SCHEMA_VERSION}. Run the importer from the same version as the app.`,
      );
    }
    const from = resolve(options.from);
    const sourceRoot = resolveSourceRoot(from);
    const snapshot = snapshotSource(sourceRoot);
    stagingDir = snapshot.stagingDir;
    const plan = planImport({
      stagingDbPath: snapshot.stagingDbPath,
      sourceRoot,
      ...(sourceRoot === from ? {} : { sourceAliases: [from] }),
      sourceSchemaVersion: snapshot.sourceSchemaVersion,
      target,
    });
    if (!options.apply) return { report: plan.report };
    const stamp = new Date().toISOString().replace(/[-:]/gu, "");
    const backupDir = `${paths.profileNamespace}.pre-poracode-import-${stamp}`;
    const inserted = await applyImport({
      plan,
      stagingDbPath: snapshot.stagingDbPath,
      sourceRoot,
      target,
      backupDir,
    });
    return { report: plan.report, inserted, backupDir };
  } finally {
    if (stagingDir) removeStagingDir(stagingDir);
    fence?.release();
    lease.release();
  }
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const list = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([key, n]) => `${key} ${n}`)
    .join(", ") || "none";

export function formatImportResult(result: ImportResult, apply: boolean): string {
  const { report } = result;
  const lines = [
    `Poracode data: ${report.sourceRoot} (schema ${report.sourceSchemaVersion}, migrated copy ${mb(report.stagingBytes)})`,
    `ViscosityCode data: ${report.targetDataRoot}`,
    `Projects: ${report.projects.source} in Poracode; ${report.projects.folded} already in ViscosityCode (kept as they are), ${report.projects.added} added${report.projects.renamedIds ? `, ${report.projects.renamedIds} given new ids` : ""}`,
    `Chats: ${report.threads.source} in Poracode; ${report.threads.alreadyPresent} already imported, ${report.threads.added} to add (${report.threads.archived} archived)`,
    `  by agent: ${list(report.threads.byAgentKind)}`,
    `  by view: ${list(report.threads.byPresentation)}`,
    ...(report.threads.withAgentInstance
      ? [
          `  ${report.threads.withAgentInstance} use a Poracode agent profile; they open with the default account`,
        ]
      : []),
    ...(report.threads.droppedWorkspaceGrants
      ? [
          `  ${report.threads.droppedWorkspaceGrants} lose their extra folder grants (re-add them in the chat)`,
        ]
      : []),
    `Rows to add: ${list(report.rows)}`,
    `Workspaces: ${report.workspaces.mapped} matched by name, ${report.workspaces.added.length} to add${report.workspaces.added.length ? ` (${report.workspaces.added.join(", ")})` : ""}`,
    `Attachments: ${report.attachments.folders} folders, ${report.attachments.files} files, ${mb(report.attachments.bytes)}; ${report.rewrittenPaths} rows point at the new folder`,
    `Not imported: ${
      Object.entries(report.skipped)
        .map(([name, skipped]) => `${name} ${skipped.rows} (${skipped.reason})`)
        .join("; ") || "nothing"
    }`,
    "Not copied: Poracode settings, keybindings, secret key, worktrees and installed ACP agents.",
  ];
  if (!apply) {
    lines.push("Dry run: nothing was written. Run again with --apply to import.");
  } else {
    lines.push(
      `Imported: ${list(result.inserted ?? {})}`,
      `Backup: ${result.backupDir}`,
      "To undo: quit ViscosityCode, copy the backup's state.sqlite (and settings.json) over the ones in the ViscosityCode data folder, and delete state.sqlite-wal and state.sqlite-shm there.",
    );
  }
  return lines.join("\n");
}

const USAGE =
  "Usage: node scripts/viscosity/import-poracode.mjs [--apply] [--from ~/.poracode] [--to ~/.viscositycode]";

/** `~` and `~/`; on Windows also `~\\` and `%VAR%`, which cmd or PowerShell can pass through unexpanded. */
function expandHome(path: string): string {
  const windows = process.platform === "win32";
  const expanded = windows
    ? path.replace(/%([^%]+)%/gu, (match, name: string) => process.env[name] ?? match)
    : path;
  if (expanded === "~") return homedir();
  return (windows ? /^~[\\/]/u : /^~\//u).test(expanded)
    ? join(homedir(), expanded.slice(2))
    : expanded;
}

export function parseImportArgs(argv: readonly string[]): ImportOptions {
  let from = join(homedir(), ".poracode");
  let to = join(homedir(), userDataDirNameFor("stable"));
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if ((arg === "--from" || arg === "--to") && argv[index + 1]) {
      const value = resolve(expandHome(argv[++index]!));
      if (arg === "--from") from = value;
      else to = value;
    } else throw new Error(`Unknown argument ${arg}.\n${USAGE}`);
  }
  return { from, to, apply };
}

/** CLI entry: returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseImportArgs(argv);
    const result = await runPoracodeImport(options);
    console.log(formatImportResult(result, options.apply));
    return 0;
  } catch (error) {
    console.error(`Import refused: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
