import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { closeDatabase, initDatabase } from "@/host/db/connection";
import { classifyTables, IMPORT_TABLES, SKIP_TABLES } from "./tablePolicy";

let root: string | undefined;

afterEach(() => {
  closeDatabase();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it("classifies every table of the current schema exactly once", () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "vc-table-policy-")));
  const sqlite = initDatabase(join(root, "state.sqlite"));
  const imported = IMPORT_TABLES.map((table) => table.name);
  const skipped = Object.keys(SKIP_TABLES);
  expect(imported.filter((name) => skipped.includes(name))).toEqual([]);
  expect(new Set(imported).size).toBe(imported.length);
  // A new upstream table makes this fail until it is classified.
  expect(classifyTables(sqlite).toSorted()).toEqual([...imported, ...skipped].toSorted());
});

it("refuses an unclassified table", () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "vc-table-policy-")));
  const sqlite = initDatabase(join(root, "state.sqlite"));
  sqlite.prepare("CREATE TABLE brand_new_upstream_table (id TEXT)").run();
  expect(() => classifyTables(sqlite)).toThrow(/brand_new_upstream_table/u);
});
