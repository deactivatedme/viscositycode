import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "@/shared/atomicFile";
import {
  chatTurnSchema,
  CODE_SHARE_APP_PATH,
  CODE_SHARE_PROJECT_PROTOCOL,
  guestSnapshotSchema,
  projectTurnProgressSchema,
} from "@/shared/codeShare";
import { readBoundedResponseBody } from "@/shared/remote/responseBody";
import {
  codeShareProjectAccessSchema,
  configureCodeShareProjectsSchema,
  type CodeShareProjectAccess,
} from "@/shared/codeShareProjectAccess";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/shared/secretStorage";
import type { ShareFileResult } from "@/shared/codeShareFileTools";

const ok = z.object({ ok: z.literal(true) });
const responseError = z.object({ message: z.string().max(500) });
const savedAccess = z.strictObject({
  version: z.literal(1),
  access: z.string().max(4096).refine(isEncryptedSecret),
});

export class ProjectShareConnection {
  constructor(
    readonly access: CodeShareProjectAccess,
    readonly signal: AbortSignal,
  ) {}

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const deadline = AbortSignal.timeout(12_000);
    const response = await fetch(this.access.origin + CODE_SHARE_APP_PATH + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + this.access.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
    }).catch(() => {
      throw new Error("The CodeShare owner host could not be reached.");
    });
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(await readBoundedResponseBody(response, 5 * 1024 * 1024)),
    );
    if (!response.ok) {
      const error = responseError.safeParse(payload);
      throw new Error(error.success ? error.data.message : "The CodeShare request was rejected.");
    }
    return schema.parse(payload);
  }

  snapshot(signal?: AbortSignal) {
    return this.request("/session", guestSnapshotSchema, undefined, signal);
  }

  start(threadId: string, id: string, model: string, prompt: string) {
    // Admission may already have committed when a client stops. The session
    // waits for this request, then addresses Stop with the same request ID.
    return this.request("/project/turns", chatTurnSchema, { threadId, id, model, prompt });
  }

  progress(threadId: string, id: string, signal: AbortSignal) {
    return this.request("/project/progress", projectTurnProgressSchema, { threadId, id }, signal);
  }

  fileResult(threadId: string, id: string, requestId: string, result: ShareFileResult) {
    return this.request("/project/file-result", ok, { threadId, id, requestId, result });
  }

  stop(threadId: string, id: string) {
    return this.request("/project/stop", ok, { threadId, id });
  }
}

/** A share grant is local to this host profile and cannot enter settings sync. */
export class CodeShareProjectConnections {
  private readonly file: string;
  private generation = new AbortController();
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly baseDir: string) {
    this.file = join(baseDir, "codeshare-project-access.json");
  }

  current(): ProjectShareConnection | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const saved = savedAccess.parse(JSON.parse(raw));
    const access = codeShareProjectAccessSchema.parse(
      JSON.parse(decryptSecret(this.baseDir, saved.access)),
    );
    return new ProjectShareConnection(access, this.generation.signal);
  }

  configure(payload: unknown): Promise<{ connected: boolean }> {
    const change = configureCodeShareProjectsSchema.parse(payload);
    const task = this.operation.then(async () => {
      // Refuse an unknown document version before overwriting or disconnecting.
      const current = this.current();
      const access = codeShareProjectAccessSchema.parse({
        origin: change.origin,
        token: change.token,
      });
      if (change.action === "disconnect") {
        if (
          current &&
          (current.access.origin !== access.origin || current.access.token !== access.token)
        )
          return { connected: false };
        rmSync(this.file, { force: true });
      } else {
        const state = await new ProjectShareConnection(access, this.generation.signal).snapshot();
        if (
          state.room ||
          state.status !== "active" ||
          state.projectProtocol !== CODE_SHARE_PROJECT_PROTOCOL
        )
          throw new Error("This invite does not grant access to CodeShare project chats.");
        const encrypted = encryptSecret(this.baseDir, JSON.stringify(access));
        writeFileAtomic(this.file, JSON.stringify({ version: 1, access: encrypted }), {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      this.generation.abort();
      this.generation = new AbortController();
      return { connected: change.action === "connect" };
    });
    this.operation = task.catch(() => undefined);
    return task;
  }
}
