import type Database from "better-sqlite3";

export interface ImportTable {
  readonly name: string;
  /** Key whose conflict keeps the existing ViscosityCode row; any other conflict aborts. */
  readonly keepExisting?: readonly string[];
}

/** Copied in foreign-key order. Stream heads and head blocks are merged by `apply.ts` (head_id remap). */
export const IMPORT_TABLES: readonly ImportTable[] = [
  { name: "projects" },
  { name: "project_notes", keepExisting: ["project_id"] },
  { name: "threads" },
  { name: "thread_runtime_items" },
  { name: "thread_runtime_item_payload_origins" },
  { name: "thread_runtime_item_stream_state" },
  { name: "thread_runtime_item_stream_chunks" },
  { name: "thread_runtime_item_stream_heads" },
  { name: "thread_runtime_item_stream_head_blocks" },
  { name: "runtime_inline_image_blobs", keepExisting: ["blob_hash"] },
  { name: "thread_runtime_item_image_refs" },
  { name: "thread_completed_turns" },
  { name: "thread_context_usage" },
  { name: "thread_token_usage" },
  { name: "thread_history_revisions", keepExisting: ["thread_id"] },
  { name: "thread_fork_contexts" },
  { name: "thread_terminal_scrollback" },
  { name: "thread_terminal_scrollback_chunks" },
];

export const SKIP_TABLES: Readonly<Record<string, string>> = {
  app_state: "window layout, view, browser history and device id belong to this install",
  usage_events: "usage statistics, not chats; pruned by the retention window",
  usage_token_ledger: "usage statistics, not chats",
  usage_token_samples: "usage statistics, not chats",
  scheduled_tasks: "importing would run the automation a second time",
  scheduled_task_runs: "history of schedules that are not imported",
  pr_watches: "importing would run the automation a second time",
  thread_runtime_gaps: "tied to the source database's persistence epoch",
  thread_runtime_gap_notices: "tied to the source database's persistence epoch",
  thread_runtime_epoch_touches: "tied to the source database's persistence epoch",
  runtime_persistence_epoch: "tied to the source database's persistence epoch",
  remote_command_receipts: "in-flight command journal",
  checkpoint_revert_operations: "in-flight revert journal",
  thread_workspace_grant_operations: "in-flight grant journal; grants are host minted",
  main_created_threads: "in-flight creation journal",
  conversation_search_documents: "search index; rebuilt by the target's triggers",
  conversation_search_pending: "search queue; refilled by the target's triggers",
  conversation_search_meta: "search index generation",
  conversation_search_fts: "search index",
  conversation_search_fts_config: "search index",
  conversation_search_fts_data: "search index",
  conversation_search_fts_docsize: "search index",
  conversation_search_fts_idx: "search index",
};

/** Throws on any table in neither list, so a new upstream table forces a decision here. */
export function classifyTables(sqlite: InstanceType<typeof Database>, schema = "main"): string[] {
  const names = (
    sqlite
      .prepare(
        `SELECT name FROM "${schema}".sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
  const imported = new Set(IMPORT_TABLES.map((table) => table.name));
  const unknown = names.filter((name) => !imported.has(name) && !(name in SKIP_TABLES));
  if (unknown.length > 0) {
    throw new Error(
      `Unclassified tables ${unknown.join(", ")}: decide in poracodeImport/tablePolicy.ts whether to import them.`,
    );
  }
  return names;
}
