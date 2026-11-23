import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { readBoundedNodeRequestBody } from "@/shared/http";
import {
  MAX_SHARE_FILE_CHARS,
  shareFileResultSchema,
  type ShareFileBridge,
  type ShareFileResult,
  type ShareFileTool,
} from "@/shared/codeShareFileTools";
import { ShareError } from "@/shared/codeShare";
import { shareSecret } from "./store";

interface PendingTool {
  id: string;
  tool: ShareFileTool;
  resolve: (value: ShareFileResult) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}
export class ShareFileWorkspace {
  readonly id = randomUUID();
  readonly token = shareSecret();
  private active = true;
  private count = 0;
  private readonly pending = new Map<string, PendingTool>();
  constructor(readonly origin: string) {}
  get bridge(): ShareFileBridge {
    return { url: `${this.origin}/api/v1/runtime-tools/${this.id}`, token: this.token };
  }
  authorized(value: string): boolean {
    return (
      this.active &&
      value.length === this.token.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(this.token))
    );
  }
  requests() {
    // One dispatched operation bounds each response and lets Stop fence the
    // next write before it reaches the selected computer.
    return [...this.pending.values()].slice(0, 1).map(({ id, tool }) => ({ id, tool }));
  }
  invoke(tool: ShareFileTool): Promise<ShareFileResult> {
    if (!this.active) return Promise.reject(new Error("This shared file turn has ended."));
    if (this.pending.size >= 32 || ++this.count > 500)
      return Promise.reject(new Error("The shared turn reached its file-operation budget."));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "The file request timed out and may already have applied. Read the file before retrying.",
          ),
        );
      }, 60_000).unref();
      this.pending.set(id, { id, tool, resolve, reject, timer });
    });
  }
  respond(id: string, value: ShareFileResult): void {
    const request = this.pending.get(id);
    if (!request) return; // A lost response or cancelled native call is safe to acknowledge.
    const result = shareFileResultSchema.parse(value);
    if (JSON.stringify(result).length > MAX_SHARE_FILE_CHARS + 16_000)
      throw new ShareError(413, "file_result_limit", "The file result is too large.");
    clearTimeout(request.timer);
    this.pending.delete(id);
    request.resolve(result);
  }
  stop(): void {
    this.active = false;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("The shared turn was stopped."));
    }
    this.pending.clear();
  }
}

export class ShareFileToolGateway {
  private origin = "";
  private readonly workspaces = new Map<string, ShareFileWorkspace>();
  setOrigin(origin: string): void {
    this.origin = origin;
  }
  create(): ShareFileWorkspace {
    if (!this.origin) throw new Error("The file bridge is not ready.");
    const workspace = new ShareFileWorkspace(this.origin);
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }
  remove(workspace: ShareFileWorkspace): void {
    workspace.stop();
    this.workspaces.delete(workspace.id);
  }
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/api/v1/runtime-tools/")) return false;
    const workspace = this.workspaces.get(path.slice("/api/v1/runtime-tools/".length));
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!workspace?.authorized(token)) {
      res.writeHead(401);
      res.end();
      return true;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end();
      return true;
    }
    const bytes = await readBoundedNodeRequestBody(
      req,
      1024 * 1024,
      () => new ShareError(413, "tool_limit", "File tool request too large."),
    );
    let body: unknown;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      res.writeHead(400);
      res.end();
      return true;
    }
    const server = new McpServer({ name: "codeshare-workspace", version: "1.0.0" });
    const call = async (tool: ShareFileTool) => {
      const result = await workspace.invoke(tool);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.ok ? result.value : { error: result.error }),
          },
        ],
        isError: !result.ok,
      };
    };
    server.registerTool(
      "find_files",
      {
        description:
          "Find files in the selected participant's approved project. An empty query lists its top-level entries. Ignored and private files are excluded.",
        inputSchema: { query: z.string().max(256) },
      },
      (args) => call({ name: "find_files", ...args }),
    );
    server.registerTool(
      "read_file",
      {
        description:
          "Read a project-relative text file. Use its modifiedAtMs when writing so concurrent edits are preserved.",
        inputSchema: { path: z.string().max(1024) },
      },
      (args) => call({ name: "read_file", ...args }),
    );
    server.registerTool(
      "write_file",
      {
        description:
          "Replace a previously read text file, only if its expected modification time still matches.",
        inputSchema: {
          path: z.string().max(1024),
          content: z.string().max(MAX_SHARE_FILE_CHARS),
          expectedModifiedAtMs: z.number().nonnegative(),
        },
      },
      (args) => call({ name: "write_file", ...args }),
    );
    server.registerTool(
      "create_file",
      {
        description: "Create a new project-relative text file. Existing files are never replaced.",
        inputSchema: { path: z.string().max(1024), content: z.string().max(MAX_SHARE_FILE_CHARS) },
      },
      (args) => call({ name: "create_file", ...args }),
    );
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.once("close", () => {
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return true;
  }
  close(): void {
    for (const workspace of this.workspaces.values()) workspace.stop();
    this.workspaces.clear();
  }
}
