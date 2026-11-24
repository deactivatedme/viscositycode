import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadConfig,
  ThreadServerRequestId,
} from "@/shared/contracts";
import { MAX_PROMPT_CHARS, projectTurnRefSchema } from "@/shared/codeShare";
import { CODE_SHARE_REMOTE_TURN_TIMEOUT_MS } from "@/shared/codeShareFileTools";
import type { CodeShareFileRuntime } from "../../codeShareFileRuntime";
import { createKnownSessionRef } from "../base";
import type {
  CreateStructuredSessionInput,
  StartTurnOptions,
  StructuredSessionHandle,
  StructuredSessionListener,
} from "../base";
import type { ProjectShareConnection } from "./connection";

interface ProjectTurn {
  id: string;
  abort: AbortController;
  done: Promise<void>;
  approval?: { id: string; respond: (allowed: boolean) => void };
}

const approvalResponse = z.object({ optionId: z.enum(["allow", "deny"]) });

export class CodeShareProjectSession implements StructuredSessionHandle {
  readonly launchOptions = {};
  readonly placesTurnContext = true;
  private readonly sessionRef: SessionRef;
  private listener?: StructuredSessionListener;
  private running: ProjectTurn | undefined;
  private disposed = false;

  constructor(
    private readonly input: CreateStructuredSessionInput,
    private readonly connection: ProjectShareConnection,
    private readonly files: CodeShareFileRuntime,
  ) {
    const { threadId, sessionRef } = input;
    const executionIdentity = createHash("sha256")
      .update(connection.access.origin + "\n" + connection.access.token)
      .digest("hex");
    projectTurnRefSchema.shape.threadId.parse(threadId);
    if (
      sessionRef &&
      (sessionRef.executionIdentity !== executionIdentity ||
        sessionRef.providerSessionId !== threadId)
    )
      throw new Error("This chat belongs to a different CodeShare invite. Start a new chat.");
    this.sessionRef = sessionRef ?? { ...createKnownSessionRef(threadId), executionIdentity };
  }

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;
  }

  getSessionRef(): SessionRef {
    return this.sessionRef;
  }

  async openThread(): Promise<string> {
    this.connection.signal.throwIfAborted();
    return this.sessionRef.providerSessionId;
  }

  async startTurn(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (this.disposed || this.running) throw new Error("This CodeShare chat is closed or busy.");
    this.connection.signal.throwIfAborted();
    if (!config.model) throw new Error("Choose a shared model.");
    if (segments?.some(({ kind }) => kind === "attachment"))
      throw new Error("CodeShare accepts text prompts and project-relative file references.");
    if (prompt.trim().length > MAX_PROMPT_CHARS)
      throw new Error("The CodeShare prompt exceeds the host limit.");
    const turn: ProjectTurn = {
      id: randomUUID(),
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    const admission = Promise.withResolvers<void>();
    this.running = turn;
    turn.done = this.run(turn, config.model, prompt, options, admission).finally(() => {
      if (this.running === turn) this.running = undefined;
    });
    await admission.promise;
  }

  private async run(
    active: ProjectTurn,
    model: string,
    prompt: string,
    options: StartTurnOptions | undefined,
    admission: PromiseWithResolvers<void>,
  ): Promise<void> {
    const { threadId, projectLocation } = this.input;
    const { id } = active;
    const signal = AbortSignal.any([
      active.abort.signal,
      this.connection.signal,
      AbortSignal.timeout(CODE_SHARE_REMOTE_TURN_TIMEOUT_MS + 15_000),
    ]);
    let opened = false;
    let completed = false;
    let assistant = "";
    let itemId: string | undefined;
    let workspace: Awaited<ReturnType<CodeShareFileRuntime["open"]>> | undefined;
    let mayAccessFiles: boolean | undefined;
    const fail = (error: unknown) => {
      if (!opened) {
        admission.reject(error);
        return;
      }
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : "The shared turn failed.";
        this.emit({ type: "error", threadId, message });
      }
    };
    try {
      signal.throwIfAborted();
      let turn = await this.connection.start(threadId, id, model, prompt);
      opened = true;
      this.emit({ type: "turn.started", threadId, turnId: id });
      const userId = options?.userMessageItemId ?? randomUUID();
      this.emit({
        type: "item.started",
        threadId,
        itemId: userId,
        itemType: "user_message",
        payload: { content: [{ kind: "text", text: prompt }] },
      });
      this.emit({ type: "item.completed", threadId, itemId: userId });
      this.listener?.onUpdate({
        status: "working",
        attention: "none",
        sessionRef: this.sessionRef,
      });
      admission.resolve();
      options?.onPromptSubmitted?.();
      while (true) {
        signal.throwIfAborted();
        if (turn.reply.startsWith(assistant) && turn.reply.length > assistant.length) {
          if (itemId === undefined) {
            itemId = randomUUID();
            this.emit({
              type: "item.started",
              threadId,
              itemId,
              itemType: "assistant_message",
              payload: { content: [] },
            });
          }
          this.emit({
            type: "content.delta",
            threadId,
            itemId,
            stream: "assistant_text",
            delta: turn.reply.slice(assistant.length),
          });
          assistant = turn.reply;
        }
        if (turn.status !== "running") {
          if (turn.status !== "complete")
            throw new Error("The owner could not complete this turn.");
          if (turn.inputTokens !== null && turn.outputTokens !== null)
            this.emit({
              type: "usage.spent",
              threadId,
              usage: {
                counterKind: "per-call",
                counter: turn.inputTokens + turn.outputTokens,
                sampleId: id,
                scopeId: threadId,
                epoch: 0,
                model,
                occurredAt: Date.now(),
                tokens: {
                  input: turn.inputTokens,
                  output: turn.outputTokens,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
              },
            });
          completed = true;
          break;
        }
        await delay(700, undefined, { signal });
        const progress = await this.connection.progress(threadId, id, signal);
        turn = progress.turn;
        for (const request of progress.requests) {
          signal.throwIfAborted();
          mayAccessFiles ??= await this.approveProject(active, signal);
          signal.throwIfAborted();
          // Approval can outlive the request. Recheck revocation, Stop and
          // owner state before opening a local grant or applying a write.
          const current = await this.connection.progress(threadId, id, signal);
          turn = current.turn;
          if (
            turn.status !== "running" ||
            !current.requests.some((pending) => pending.id === request.id)
          )
            break;
          if (mayAccessFiles) workspace ??= await this.files.open({ projectLocation });
          signal.throwIfAborted();
          const result = workspace
            ? await this.files.execute({
                ...workspace,
                projectLocation,
                requestId: request.id,
                tool: request.tool,
              })
            : { ok: false as const, error: "The participant declined workspace access." };
          if (!signal.aborted) await this.connection.fileResult(threadId, id, request.id, result);
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      if (workspace) await this.files.end({ projectLocation, ...workspace });
      // An HTTP admission response can be lost after the owner admits a turn.
      if (!completed) await this.connection.stop(threadId, id).catch(() => undefined);
      if (opened) {
        if (itemId) this.emit({ type: "item.completed", threadId, itemId });
        this.emit({
          type: "turn.completed",
          threadId,
          turnId: id,
          state: completed ? "completed" : signal.aborted ? "cancelled" : "failed",
        });
        this.listener?.onUpdate({
          status: completed || signal.aborted ? "idle" : "error",
          attention: "none",
        });
      }
    }
  }

  private async approveProject(active: ProjectTurn, turnSignal: AbortSignal): Promise<boolean> {
    const threadId = this.input.threadId;
    const id = randomUUID();
    const approval = Promise.withResolvers<boolean>();
    const signal = AbortSignal.any([turnSignal, AbortSignal.timeout(45_000)]);
    const cancel = () => approval.resolve(false);
    active.approval = { id, respond: approval.resolve };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    this.emit({
      type: "request.opened",
      threadId,
      requestId: id,
      requestType: "file_change_approval",
      payload: {
        summary: "Allow this CodeShare turn to read and edit files in this project?",
        options: [
          { optionId: "allow", label: "Allow once" },
          { optionId: "deny", label: "Decline" },
        ],
      },
    });
    this.listener?.onUpdate({ status: "needs_approval", attention: "needs_approval" });
    const allowed = await approval.promise;
    signal.removeEventListener("abort", cancel);
    delete active.approval;
    this.emit({
      type: "request.resolved",
      threadId,
      requestId: id,
      outcome: allowed ? "accepted" : "declined",
    });
    if (!turnSignal.aborted) this.listener?.onUpdate({ status: "working", attention: "none" });
    return allowed;
  }

  async resolveServerRequest(id: ThreadServerRequestId, response: unknown): Promise<void> {
    const approval = this.running?.approval;
    if (!approval || approval.id !== id) throw new Error("This CodeShare approval has ended.");
    approval.respond(approvalResponse.parse(response).optionId === "allow");
  }

  async interruptTurn(): Promise<void> {
    const turn = this.running;
    turn?.abort.abort();
    await turn?.done;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.interruptTurn();
  }

  private emit(event: RuntimeEvent): void {
    this.listener?.onRuntimeEvent?.(event);
  }
}
