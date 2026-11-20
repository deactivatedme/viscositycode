import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HostOwnerLease } from "@/backend/ownership/hostOwnerLease";
import { prepareOwnedHostRoot } from "@/backend/ownership/hostRootManifest";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { closeDatabase, initDatabase } from "@/host/db/connection";
import { LATEST_SCHEMA_VERSION } from "@/host/db/migrations";
import { dbGetProjects, dbGetThreads } from "@/host/db/projectsThreads";
import { dbGetThreadRuntimeItems } from "@/host/db/runtimeItems";
import { messageItemPayloadSchema, projectSchema, threadSchema } from "@/shared/contracts";
import { main, parseImportArgs, runPoracodeImport } from "./cli";

// Windows: Defender or the indexer can still hold the fresh staging copy at cleanup.
const fsFault = vi.hoisted(() => ({ stagingBusy: false }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    rmSync: (...args: Parameters<typeof original.rmSync>) => {
      if (fsFault.stagingBusy && String(args[0]).includes("viscosity-poracode-import-")) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      original.rmSync(...args);
    },
  };
});

const fixture = join(import.meta.dirname, "../../../backend/ownership/fixtures/released-1.8.2");
const GUI_THREAD = "18200000-0000-4000-8000-000000000002";
const TERMINAL_THREAD = "18200000-0000-4000-8000-000000000003";
const ATTACHMENT_DIR = "18200000-000";
const createdAt = "2026-11-01T00:00:00.000Z";
const THREAD_CONFIG = JSON.stringify({
  model: "gpt-5",
  effort: "high",
  fast: false,
  thinking: false,
  contextSize: "default",
});

let root: string;
let source: string;
let namespace: string;
let lease: HostOwnerLease | undefined;

const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const dataRoot = () => `${namespace}.host-v1`;
const targetDb = () => join(dataRoot(), "state.sqlite");
const backups = () =>
  readdirSync(dirname(namespace)).filter((name) =>
    name.startsWith(`${basename(namespace)}.pre-poracode-import-`),
  );

function edit(path: string, statements: string[]): void {
  const sqlite = new Database(path);
  try {
    for (const sql of statements) sqlite.prepare(sql).run();
  } finally {
    sqlite.close();
  }
}

/** Released 1.8.2 data plus a second project, workspaces and one attachment. */
function makeSource(): void {
  mkdirSync(join(source, "attachments", ATTACHMENT_DIR), { recursive: true });
  copyFileSync(join(fixture, "state.sqlite"), join(source, "state.sqlite"));
  writeFileSync(join(source, "attachments", ATTACHMENT_DIR, "a.png"), "png bytes");
  const attachment = join(source, "attachments", ATTACHMENT_DIR, "a.png");
  const payload = JSON.stringify({
    content: [
      { kind: "text", text: "Preserve this 1.8.2 prompt" },
      { kind: "file", path: attachment, source: "attachment" },
    ],
  });
  edit(join(source, "state.sqlite"), [
    `UPDATE thread_runtime_items SET payload = '${payload}' WHERE item_id = 'old-user'`,
    `INSERT INTO projects (id, name, location_kind, location_path, workspace_id, disabled, sort_order, created_at)
     VALUES ('pc-other', 'Other', 'posix', '/pc-other', 'pc-side', 0, 0, '${createdAt}')`,
    `UPDATE threads SET project_id = 'pc-other' WHERE id = '${TERMINAL_THREAD}'`,
  ]);
  writeFileSync(
    join(source, "settings.json"),
    JSON.stringify({
      workspaces: [
        { id: "pc-work", name: " work ", createdAt, icon: "briefcase" },
        { id: "pc-side", name: "Side Hustle", createdAt, icon: "rocket" },
      ],
    }),
  );
}

/** An activated ViscosityCode root with its own project at the fixture's location and one chat. */
function makeTarget(): void {
  const paths = resolveHostRootPaths(namespace);
  const owner = HostOwnerLease.acquire(paths, "desktop");
  try {
    prepareOwnedHostRoot(owner);
    const sqlite = initDatabase(targetDb());
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, location_kind, location_path, sort_order, created_at)
         VALUES ('vc-project', 'Mine', 'posix', '/poracode-upgrade-fixture/project', 3, ?)`,
      )
      .run(createdAt);
    sqlite
      .prepare(
        `INSERT INTO threads (id, project_id, title, agent_kind, config, status, attention, created_at, updated_at, presentation_mode)
         VALUES ('vc-thread', 'vc-project', 'Mine', 'codex', ?, 'idle', 'none', ?, ?, 'gui')`,
      )
      .run(THREAD_CONFIG, createdAt, createdAt);
    closeDatabase();
  } finally {
    owner.release();
  }
  writeFileSync(
    join(dataRoot(), "settings.json"),
    JSON.stringify({ workspaces: [{ id: "vc-work", name: "Work", createdAt, icon: "briefcase" }] }),
  );
}

const STREAM_HEAD = (thread: string, item: string) =>
  `INSERT INTO thread_runtime_item_stream_heads (head_id, thread_id, item_id, stream_key, stream_order, seed_chars,
     head_chars, next_seq, open_seq, open_chars, head_wire_bytes, head_json_units, head_has_content, head_last_unit)
   VALUES (1, '${thread}', '${item}', 'assistant_text', 0, 0, 1, 1, 0, 1, 1, 1, 1, 97)`;
const STREAM_BLOCK = "INSERT INTO thread_runtime_item_stream_head_blocks VALUES (1, 0, 1, X'6100')";

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "vc-poracode-import-")));
  source = join(root, "poracode");
  namespace = join(root, "vc");
  mkdirSync(join(root, "tmp"));
  // Staging folders land here, so the test can prove they are removed.
  vi.stubEnv("TMPDIR", join(root, "tmp"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  makeSource();
});

afterEach(() => {
  fsFault.stagingBusy = false;
  closeDatabase();
  lease?.release();
  lease = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

it("dry run reports the import and writes nothing", async () => {
  makeTarget();
  const sourceBefore = digest(join(source, "state.sqlite"));
  const targetBefore = digest(targetDb());
  const { report, inserted } = await runPoracodeImport({
    from: source,
    to: namespace,
    apply: false,
  });
  expect(inserted).toBeUndefined();
  expect(report.sourceSchemaVersion).toBe(42);
  expect(report.projects).toEqual({ source: 2, folded: 1, added: 1, renamedIds: 0 });
  expect(report.threads).toMatchObject({
    source: 2,
    alreadyPresent: 0,
    added: 2,
    byAgentKind: { codex: 2 },
    byPresentation: { gui: 1, terminal: 1 },
  });
  expect(report.rows).toMatchObject({ thread_runtime_items: 3, project_notes: 1 });
  expect(report.workspaces).toEqual({ mapped: 1, added: ["Side Hustle"] });
  expect(report.attachments).toEqual({ folders: 1, files: 1, bytes: 9 });
  expect(report.rewrittenPaths).toBe(1);
  expect(report.skipped.scheduled_tasks?.rows).toBe(1);
  expect(digest(join(source, "state.sqlite"))).toBe(sourceBefore);
  expect(digest(targetDb())).toBe(targetBefore);
  expect(backups()).toEqual([]);
  expect(existsSync(join(dataRoot(), "attachments"))).toBe(false);
  expect(readdirSync(join(root, "tmp"))).toEqual([]);
});

it("dry run leaves a leftover ViscosityCode WAL untouched", async () => {
  makeTarget();
  // Simulate a crash: capture the files while a write is still only in the WAL.
  const files = ["", "-wal", "-shm"].map((suffix) => `${targetDb()}${suffix}`);
  const writer = new Database(targetDb());
  writer.pragma("wal_autocheckpoint = 0");
  writer.prepare("UPDATE projects SET name = 'Unsaved' WHERE id = 'vc-project'").run();
  const crashed = files.map((path) => readFileSync(path));
  writer.close();
  files.forEach((path, index) => writeFileSync(path, crashed[index]!));
  expect(crashed[1]!.length).toBeGreaterThan(0);
  const durable = files.slice(0, 2);
  const before = durable.map(digest);
  await runPoracodeImport({ from: source, to: namespace, apply: false });
  expect(durable.map(digest)).toEqual(before);
  // Any reader updates the -shm wal-index (read marks); it must only still exist.
  expect(existsSync(files[2]!)).toBe(true);
  const reader = new Database(targetDb(), { readonly: true });
  try {
    expect(reader.prepare("SELECT name FROM projects").pluck().get()).toBe("Unsaved");
  } finally {
    reader.close();
  }
});

it("files each chat under its own project when a fold and an id collision share an id", async () => {
  makeTarget();
  // The fixture project folds into vc-project by location; a later source project
  // reuses the id vc-project for another folder and must get a new id.
  edit(join(source, "state.sqlite"), [
    `INSERT INTO projects (id, name, location_kind, location_path, disabled, sort_order, created_at)
     VALUES ('vc-project', 'Collide', 'posix', '/pc-collide', 0, 1, '${createdAt}')`,
    `UPDATE threads SET project_id = 'vc-project' WHERE id = '${TERMINAL_THREAD}'`,
    `INSERT INTO project_notes (project_id, doc, updated_at) VALUES ('vc-project', 'collide note', '${createdAt}')`,
  ]);
  const { report } = await runPoracodeImport({ from: source, to: namespace, apply: true });
  expect(report.projects).toEqual({ source: 3, folded: 1, added: 2, renamedIds: 1 });
  const sqlite = new Database(targetDb(), { readonly: true });
  try {
    const projectOf = (thread: string) =>
      sqlite.prepare("SELECT project_id FROM threads WHERE id = ?").pluck().get(thread);
    const renamed = sqlite
      .prepare("SELECT id FROM projects WHERE location_path = '/pc-collide'")
      .pluck()
      .get() as string;
    expect(renamed).not.toBe("vc-project");
    expect(projectOf(GUI_THREAD)).toBe("vc-project");
    expect(projectOf(TERMINAL_THREAD)).toBe(renamed);
    const notes = Object.fromEntries(
      sqlite.prepare("SELECT project_id, doc FROM project_notes").raw().all() as [string, string][],
    );
    expect(notes[renamed]).toBe("collide note");
    expect(notes["vc-project"]).toBeDefined();
    expect(notes["vc-project"]).not.toBe("collide note");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally {
    sqlite.close();
  }
});

it("apply merges chats into the existing root and a rerun adds nothing", async () => {
  makeTarget();
  const sourceBefore = digest(join(source, "state.sqlite"));
  const first = await runPoracodeImport({ from: source, to: namespace, apply: true });
  expect(first.inserted).toMatchObject({ threads: 2, projects: 1, thread_runtime_items: 3 });
  expect(digest(join(source, "state.sqlite"))).toBe(sourceBefore);
  expect(backups()).toHaveLength(1);
  const backupDir = join(dirname(namespace), backups()[0]!);
  // The backup API rewrites page headers, so compare contents, not bytes.
  const backup = new Database(join(backupDir, "state.sqlite"), { readonly: true });
  try {
    expect(backup.prepare("SELECT id FROM threads").pluck().all()).toEqual(["vc-thread"]);
  } finally {
    backup.close();
  }
  expect(existsSync(join(backupDir, "settings.json"))).toBe(true);
  expect(readFileSync(join(dataRoot(), "attachments", ATTACHMENT_DIR, "a.png"), "utf8")).toBe(
    "png bytes",
  );
  const settings = JSON.parse(readFileSync(join(dataRoot(), "settings.json"), "utf8"));
  expect(settings.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
    "vc-work",
    "pc-side",
  ]);

  const sqlite = initDatabase(targetDb());
  expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  const threads = dbGetThreads().map((thread) => threadSchema.parse(thread));
  const projects = dbGetProjects().map((project) => projectSchema.parse(project));
  expect(threads.map((thread) => thread.id).toSorted()).toEqual(
    [GUI_THREAD, TERMINAL_THREAD, "vc-thread"].toSorted(),
  );
  expect(projects.map((project) => project.id).toSorted()).toEqual(["pc-other", "vc-project"]);
  expect(projects.find((project) => project.id === "vc-project")?.name).toBe("Mine");
  expect(projects.find((project) => project.id === "pc-other")?.workspaceId).toBe("pc-side");
  expect(threads.find((thread) => thread.id === GUI_THREAD)?.projectId).toBe("vc-project");
  expect(threads.find((thread) => thread.id === TERMINAL_THREAD)?.projectId).toBe("pc-other");
  expect(sqlite.prepare("SELECT project_id FROM project_notes").pluck().all()).toEqual([
    "vc-project",
  ]);
  expect(
    sqlite
      .prepare(`SELECT count(*) FROM thread_completed_turns WHERE thread_id = ?`)
      .pluck()
      .get(GUI_THREAD),
  ).toBe(1);
  const items = await dbGetThreadRuntimeItems(GUI_THREAD);
  expect(items).toHaveLength(3);
  for (const item of items.filter((entry) => entry.type.endsWith("_message"))) {
    expect(messageItemPayloadSchema.parse(item.payload)).toEqual(item.payload);
  }
  expect(JSON.stringify(items.find((item) => item.id === "old-user")?.payload)).toContain(
    JSON.stringify(join(dataRoot(), "attachments", ATTACHMENT_DIR, "a.png")).slice(1, -1),
  );
  expect(
    sqlite
      .prepare("SELECT count(*) FROM conversation_search_pending WHERE thread_id = ?")
      .pluck()
      .get(GUI_THREAD),
  ).toBeGreaterThan(0);
  const tableCounts = (db: Database.Database) =>
    Object.fromEntries(
      (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .pluck()
          .all() as string[]
      ).map((name) => [name, db.prepare(`SELECT count(*) FROM "${name}"`).pluck().get()]),
    );
  const afterFirst = tableCounts(sqlite);
  closeDatabase();

  const second = await runPoracodeImport({ from: source, to: namespace, apply: true });
  expect(second.report.threads).toMatchObject({ alreadyPresent: 2, added: 0 });
  expect(second.report.projects).toMatchObject({ folded: 2, added: 0 });
  expect(second.report.workspaces).toEqual({ mapped: 2, added: [] });
  expect(tableCounts(initDatabase(targetDb()))).toEqual(afterFirst);
});

it("remaps stream head ids that collide with the target's", async () => {
  makeTarget();
  initDatabase(join(source, "state.sqlite"));
  closeDatabase();
  edit(join(source, "state.sqlite"), [STREAM_HEAD(GUI_THREAD, "old-assistant"), STREAM_BLOCK]);
  edit(targetDb(), [
    `INSERT INTO thread_runtime_items (thread_id, item_id, position, type, state, payload)
     VALUES ('vc-thread', 'vc-item', 0, 'assistant_message', 'completed', '{"content":[]}')`,
    STREAM_HEAD("vc-thread", "vc-item"),
    STREAM_BLOCK,
  ]);
  await runPoracodeImport({ from: source, to: namespace, apply: true });
  const sqlite = new Database(targetDb(), { readonly: true });
  try {
    expect(
      sqlite
        .prepare(
          `SELECT h.thread_id FROM thread_runtime_item_stream_head_blocks b
           JOIN thread_runtime_item_stream_heads h ON h.head_id = b.head_id ORDER BY h.thread_id`,
        )
        .pluck()
        .all(),
    ).toEqual([GUI_THREAD, "vc-thread"]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally {
    sqlite.close();
  }
});

it.each([
  [
    "ViscosityCode is running",
    () => {
      lease = HostOwnerLease.acquire(resolveHostRootPaths(namespace), "desktop");
    },
    /Quit ViscosityCode first/u,
  ],
  [
    "Poracode has unsaved changes",
    () => writeFileSync(join(source, "state.sqlite-wal"), "not empty"),
    /Quit Poracode first/u,
  ],
  [
    "the target schema differs",
    () => edit(targetDb(), ["UPDATE app_state SET value = '74' WHERE key = 'schema_version'"]),
    /schema 74/u,
  ],
  [
    "the source schema is newer",
    () =>
      edit(join(source, "state.sqlite"), [
        `UPDATE app_state SET value = '${LATEST_SCHEMA_VERSION + 1}' WHERE key = 'schema_version'`,
      ]),
    /newer than this ViscosityCode/u,
  ],
])("refuses when %s and leaves the target unchanged", async (_name, arrange, message) => {
  makeTarget();
  arrange();
  const before = digest(targetDb());
  await expect(runPoracodeImport({ from: source, to: namespace, apply: true })).rejects.toThrow(
    message,
  );
  expect(digest(targetDb())).toBe(before);
  expect(backups()).toEqual([]);
  expect(readdirSync(join(root, "tmp"))).toEqual([]);
});

it("refuses a ViscosityCode profile that was never opened", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await main(["--to", namespace, "--from", source, "--apply"])).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/Open ViscosityCode once/u));
  expect(existsSync(dataRoot())).toBe(false);
});

it("reports a finished apply even when the staging copy cannot be deleted", async () => {
  makeTarget();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fsFault.stagingBusy = true;
  expect(await main(["--to", namespace, "--from", source, "--apply"])).toBe(0);
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(/Could not delete the temporary copy/u),
    expect.anything(),
  );
  expect(backups()).toHaveLength(1);
  fsFault.stagingBusy = false;
  // The lease and data fence were still released.
  await expect(runPoracodeImport({ from: source, to: namespace, apply: false })).resolves.toEqual(
    expect.objectContaining({ report: expect.anything() }),
  );
});

it("expands Windows-style home paths only on Windows", () => {
  const home = homedir();
  vi.stubEnv("PORACODE_IMPORT_TEST_HOME", join(home, "x"));
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(parseImportArgs(["--from", "~\\.poracode", "--to", "~/.viscositycode"])).toEqual({
      from: join(home, ".poracode"),
      to: join(home, ".viscositycode"),
      apply: false,
    });
    expect(parseImportArgs(["--from", "%PORACODE_IMPORT_TEST_HOME%/.poracode"]).from).toBe(
      join(home, "x", ".poracode"),
    );
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(parseImportArgs(["--from", "~/.poracode"]).from).toBe(join(home, ".poracode"));
    // A backslash is an ordinary filename character on macOS and Linux.
    expect(parseImportArgs(["--from", "~\\.poracode"]).from).toBe(resolve("~\\.poracode"));
    expect(parseImportArgs(["--from", "%PORACODE_IMPORT_TEST_HOME%"]).from).toBe(
      resolve("%PORACODE_IMPORT_TEST_HOME%"),
    );
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});
