import { lstat, realpath } from "node:fs/promises";
import { join, relative, isAbsolute, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { ProjectLocation } from "@/shared/contracts";
import {
  MAX_SHARE_FILE_CHARS,
  shareFileExecuteSchema,
  shareFileGrantSchema,
  shareFileScopeSchema,
  type ShareFileResult,
  type ShareFileTool,
} from "@/shared/codeShareFileTools";
import { ProjectTreeService } from "./projectTree";
import { execGit } from "./git/exec";

interface FileGrant {
  location: ProjectLocation;
  operations: Map<string, { signature: string; result?: Promise<ShareFileResult> }>;
  pending: Set<Promise<ShareFileResult>>;
  closing: boolean;
  lastUse: number;
}
const EXCLUDES = [
  ".git/**",
  "**/.git/**",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "tmp/**",
  ".tmp/**",
  "node_modules/**",
  "**/node_modules/**",
];
function allowedPath(path: string, windows = false): boolean {
  return path.split("/").every((part) => {
    const name = part.toLowerCase().replace(/[. ]+$/u, "");
    if ([".git", ".ssh", "node_modules", "tmp", ".tmp"].includes(name) || name.startsWith(".env"))
      return false;
    // Win32 names can address a device even under a project directory. Reject
    // reserved names, short-name aliases and shell-trimmed spellings before I/O.
    // Origin: learn.microsoft.com/windows/win32/fileio/naming-a-file
    return (
      !windows ||
      (!/[<>"|?*~]/u.test(part) &&
        !/\p{Cc}/u.test(part) &&
        !/[. ]$/u.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))
    );
  });
}
async function ignored(location: ProjectLocation, path: string): Promise<boolean> {
  try {
    await execGit(location, ["check-ignore", "--no-index", "--quiet", "--", path], {
      timeout: 5000,
    });
    return true;
  } catch (error) {
    const original = error instanceof Error && error.cause ? error.cause : error;
    const code = (original as { code?: unknown }).code;
    if (code === 1 || code === "1") return false;
    const detail = String((original as { stderr?: unknown }).stderr ?? "");
    if ((code === 128 || code === "128") && /not a git repository/iu.test(detail)) return false;
    throw new Error("Workspace ignore rules could not be checked.", { cause: error });
  }
}

/** Local supervisor authority for a user-approved, generation-bound file turn. */
export class CodeShareFileRuntime {
  private readonly incarnation = randomUUID();
  private readonly grants = new Map<string, FileGrant>();
  private closed = false;
  private readonly timer = setInterval(() => {
    for (const [id, grant] of this.grants)
      if (Date.now() - grant.lastUse > 15 * 60_000) void this.closeGrant(id, grant);
  }, 30_000).unref();
  constructor(
    private readonly tree: ProjectTreeService,
    private readonly isIgnored = ignored,
  ) {}

  async open(payload: unknown) {
    const { projectLocation } = shareFileScopeSchema.parse(payload);
    if (projectLocation.kind === "wsl")
      throw new Error("Shared file approval currently requires a native local project.");
    if (this.closed || this.grants.size >= 8)
      throw new Error("This computer is busy with shared file work.");
    const [root, home] = await Promise.all([realpath(projectLocation.path), realpath(homedir())]);
    const homeTail = relative(root, home);
    if (
      dirname(root) === root ||
      homeTail === "" ||
      (!isAbsolute(homeTail) && homeTail.split(/[\\/]/u)[0] !== "..")
    )
      throw new Error("Choose a project folder inside your workspace for shared file work.");
    // Resolve and validate the selected project before accepting a remote turn.
    await this.tree.listProjectTree({ projectLocation, directoryPath: "" });
    if (this.closed || this.grants.size >= 8)
      throw new Error("Shared file work is closing or busy.");
    const grantId = randomUUID();
    this.grants.set(grantId, {
      location: structuredClone(projectLocation),
      operations: new Map(),
      pending: new Set(),
      closing: false,
      lastUse: Date.now(),
    });
    return { grantId, incarnation: this.incarnation };
  }
  execute(payload: unknown): Promise<ShareFileResult> {
    const input = shareFileExecuteSchema.parse(payload);
    const grant =
      input.incarnation === this.incarnation ? this.grants.get(input.grantId) : undefined;
    if (
      !grant ||
      grant.closing ||
      this.closed ||
      JSON.stringify(grant.location) !== JSON.stringify(input.projectLocation)
    )
      return Promise.resolve({
        ok: false,
        error: "The approved file turn is no longer available.",
      });
    grant.lastUse = Date.now();
    const signature = createHash("sha256").update(JSON.stringify(input.tool)).digest("hex");
    const previous = grant.operations.get(input.requestId);
    if (previous && previous.signature !== signature)
      return Promise.resolve({
        ok: false,
        error: "A file request ID cannot be reused for a different operation.",
      });
    if (previous?.result) return previous.result;
    if (!previous && grant.operations.size >= 500)
      return Promise.resolve({
        ok: false,
        error: "This shared turn reached its file-operation limit.",
      });
    const receipt = previous ?? { signature };
    grant.operations.set(input.requestId, receipt);
    const result: Promise<ShareFileResult> = this.run(grant.location, input.tool).then(
      (value): ShareFileResult => ({ ok: true, value }),
      (error: unknown): ShareFileResult => ({
        ok: false,
        error:
          error instanceof Error
            ? error.message
                .split(
                  grant.location.kind === "wsl" ? grant.location.linuxPath : grant.location.path,
                )
                .join("[project]")
                .slice(0, 1000)
            : "File operation failed.",
      }),
    );
    if (input.tool.name === "write_file" || input.tool.name === "create_file")
      receipt.result = result;
    grant.pending.add(result);
    void result.finally(() => grant.pending.delete(result));
    return result;
  }
  private async run(location: ProjectLocation, tool: ShareFileTool): Promise<unknown> {
    if (tool.name === "find_files") {
      const query = tool.query.trim();
      if (!query) {
        const listing = await this.tree.listProjectTree({
          projectLocation: location,
          directoryPath: "",
        });
        const candidates = listing.entries
          .filter((entry) => allowedPath(entry.path, location.kind === "windows"))
          .slice(0, 64);
        const visible = await Promise.all(
          candidates.map(async (entry) =>
            (await this.isIgnored(location, entry.path)) ? undefined : entry,
          ),
        );
        return { entries: visible.filter((entry) => entry !== undefined) };
      }
      const result = await this.tree.searchProjectTree({
        projectLocation: location,
        query,
        limit: 64,
        searchConfig: { useIgnoreFiles: true, excludePatterns: EXCLUDES },
      });
      return {
        entries: result.entries.filter((entry) =>
          allowedPath(entry.path, location.kind === "windows"),
        ),
      };
    }
    if (location.kind === "wsl") throw new Error("A native local project is required.");
    if (!allowedPath(tool.path, location.kind === "windows"))
      throw new Error("This path is outside the approved shared file scope.");
    if (
      tool.name !== "read_file" &&
      [".gitignore", ".ignore", ".rgignore"].includes(tool.path.split("/").at(-1)!.toLowerCase())
    )
      throw new Error("Ignore policy files are read-only in a shared turn.");
    let current = location.path;
    for (const part of tool.path.split("/")) {
      current = join(current, part);
      try {
        const entry = await lstat(current);
        if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1))
          throw new Error("Linked files are outside this shared turn.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (await this.isIgnored(location, tool.path))
      throw new Error("Ignored or private files are outside this shared turn.");
    if (tool.name === "create_file") {
      await this.tree.createProjectEntry({
        projectLocation: location,
        path: tool.path,
        type: "file",
      });
      const empty = await this.tree.readProjectFile({ projectLocation: location, path: tool.path });
      return this.tree.writeProjectFile({
        projectLocation: location,
        path: tool.path,
        content: tool.content,
        baseModifiedAtMs: empty.modifiedAtMs,
      });
    }
    const read = await this.tree.readProjectFile({ projectLocation: location, path: tool.path });
    if (
      read.status !== "ready" ||
      read.content === undefined ||
      read.content.length > MAX_SHARE_FILE_CHARS
    )
      throw new Error("Only bounded text files can be shared.");
    if (tool.name === "read_file")
      return { path: tool.path, content: read.content, modifiedAtMs: read.modifiedAtMs };
    return this.tree.writeProjectFile({
      projectLocation: location,
      path: tool.path,
      content: tool.content,
      baseModifiedAtMs: tool.expectedModifiedAtMs,
    });
  }
  async end(payload: unknown) {
    const input = shareFileGrantSchema.parse(payload);
    // A different supervisor incarnation proves the previous writer has exited.
    const grant =
      input.incarnation === this.incarnation ? this.grants.get(input.grantId) : undefined;
    if (grant) {
      if (JSON.stringify(grant.location) !== JSON.stringify(input.projectLocation))
        throw new Error("The approved workspace does not match.");
      await this.closeGrant(input.grantId, grant);
    }
    return { closed: true as const };
  }
  private async closeGrant(id: string, grant: FileGrant): Promise<void> {
    grant.closing = true;
    await Promise.allSettled([...grant.pending]);
    if (this.grants.get(id) === grant) this.grants.delete(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.all([...this.grants].map(([id, grant]) => this.closeGrant(id, grant)));
  }
}
