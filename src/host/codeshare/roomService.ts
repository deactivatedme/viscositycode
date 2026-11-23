import { MAX_REPLY_CHARS, ShareError, type ShareModel, type SubmitTurn } from "@/shared/codeShare";
import type { RoomRunReceipt, ShareRoomSnapshot, ShareRoomTurn } from "@/shared/codeShareRoom";
import {
  CODE_SHARE_ROOM_PROTOCOL,
  CODE_SHARE_REMOTE_TURN_TIMEOUT_MS,
} from "@/shared/codeShareFileTools";
import { ShareFileToolGateway, type ShareFileWorkspace } from "./fileToolGateway";
import type { ShareFileResult } from "@/shared/codeShareFileTools";
import type { RunProvider } from "./providerTransport";
import type { CodeShareRoomStore, RoomMember } from "./roomStore";

const READY_TIMEOUT_MS = 12_000;
const HOST_RUN_TIMEOUT_MS = 120_000;
const MAX_HOST_RUNS = 4;

interface HostRun {
  abort: AbortController;
  complete: Promise<void>;
  workspace?: ShareFileWorkspace;
  done?: boolean;
  status?: "complete" | "failed" | "cancelled";
  reply?: string;
}

export class CodeShareRoomService {
  private readonly ready = new Map<string, number>();
  private readonly hostRuns = new Map<string, HostRun>();
  private closed = false;

  constructor(
    private readonly store: CodeShareRoomStore,
    private readonly models: ReadonlyMap<string, ShareModel>,
    private readonly runProvider: RunProvider,
    private readonly now: () => number,
    private readonly onFailure: () => void,
    private readonly modelEnabled = (_id: string) => true,
    private readonly fileTools = new ShareFileToolGateway(),
  ) {}

  private canParticipate(member: RoomMember | undefined): member is RoomMember {
    return (
      member !== undefined &&
      member.revokedAt === null &&
      member.expiresAt !== null &&
      member.expiresAt > this.now()
    );
  }

  private isReady(id: string): boolean {
    return (this.ready.get(id) ?? 0) > this.now();
  }

  setReady(member: RoomMember, ready: boolean): void {
    if (ready && this.canParticipate(member))
      this.ready.set(member.id, this.now() + READY_TIMEOUT_MS);
    else this.ready.delete(member.id);
  }

  snapshot(
    member: RoomMember,
    revision: number | undefined,
    paused: boolean,
    cursor = "",
  ): ShareRoomSnapshot {
    if (!this.canParticipate(member))
      throw new ShareError(403, "inactive", "Your access to this room has ended.");
    if (this.isReady(member.id)) this.setReady(member, true);
    const room = this.store.room(member.roomId);
    if (!room) throw new ShareError(404, "room_missing", "This room no longer exists.");
    const members = this.store.members(member.roomId, this.now(), cursor);
    return {
      protocolVersion: CODE_SHARE_ROOM_PROTOCOL,
      ...(members.length > 100 ? { nextMemberCursor: members[99]!.id } : {}),
      revision: room.revision,
      memberId: member.id,
      active: !paused,
      members: members.slice(0, 100).map((seat) => ({
        ...seat,
        ready: this.isReady(seat.id),
        models: this.store.member(seat.id)?.models ?? [],
      })),
      ...(revision === room.revision ? {} : { turns: this.store.turns(member.roomId) }),
    };
  }

  submit(member: RoomMember, input: SubmitTurn & { runner: string }, paused: boolean): void {
    this.requireActive(member, paused);
    const model = this.models.get(input.model);
    if (!model || !this.modelEnabled(input.model) || !member.models.includes(input.model))
      throw new ShareError(403, "model_denied", "This model is unavailable to you.");
    if (input.runner === "host") {
      if (model.execution === "guest-subscription")
        throw new ShareError(
          400,
          "room_runner",
          "Choose a participant for this subscription model.",
        );
    } else {
      const runner = this.store.member(input.runner);
      if (
        (model.execution !== "guest-subscription" && !model.remoteEditing) ||
        !this.canParticipate(runner) ||
        runner.roomId !== member.roomId ||
        !runner.models.includes(input.model) ||
        !this.isReady(runner.id)
      )
        throw new ShareError(409, "room_runner", "Choose a ready participant with this model.");
    }
    this.store.enqueue(
      member,
      input,
      model.execution === "guest-subscription" ? "participant" : "owner",
    );
    this.pump(member.roomId, paused);
  }

  claim(member: RoomMember, id: string, lease: string, paused: boolean): RoomRunReceipt {
    this.requireActive(member, paused);
    const turn = this.store.head(member.roomId);
    if (
      !turn ||
      turn.id !== id ||
      turn.runner !== member.id ||
      !member.models.includes(turn.model) ||
      !this.modelEnabled(turn.model) ||
      (turn.status === "queued" && !this.isReady(member.id)) ||
      (turn.status !== "queued" && turn.lease !== lease)
    )
      throw new ShareError(409, "room_claim", "This turn is no longer ready for your computer.");
    if (turn.status === "stopping")
      throw new ShareError(409, "room_claim", "This turn has been stopped.");
    if (
      turn.status === "queued" &&
      turn.execution === "owner" &&
      this.activeHostRuns() >= MAX_HOST_RUNS
    )
      throw new ShareError(409, "room_busy", "The owner is busy. Try again shortly.");
    if (turn.status === "queued" && !this.store.activate(turn, lease))
      throw new ShareError(409, "room_claim", "This turn is already running.");
    if (turn.status === "queued" && turn.execution === "owner")
      this.startHostRun(turn, this.models.get(turn.model)!);
    return {
      execution: turn.execution ?? "participant",
      id,
      model: turn.model,
      prompt: turn.prompt,
      history: this.store.context(turn).slice(0, -1),
    };
  }

  leaseStatus(
    member: RoomMember,
    id: string,
    lease: string,
    paused = false,
    reply?: string,
  ): ShareRoomTurn["status"] {
    const turn = this.store.turn(member.roomId, id);
    if (!turn || turn.runner !== member.id || turn.lease !== lease)
      throw new ShareError(409, "room_claim", "This turn is not owned by your computer.");
    if (turn.status === "running" && (paused || !this.canParticipate(member))) {
      this.store.transition(turn, "stopping");
      this.abortRun(turn.roomId);
      return "stopping";
    }
    if (
      turn.execution !== "owner" &&
      turn.status === "running" &&
      reply !== undefined &&
      reply !== turn.reply
    )
      this.store.transition(turn, "running", reply);
    return turn.status;
  }

  finish(
    member: RoomMember,
    id: string,
    lease: string,
    status: "complete" | "failed" | "cancelled",
    reply: string,
    paused: boolean,
  ): void {
    const turn = this.store.turn(member.roomId, id);
    if (!turn || turn.runner !== member.id || turn.lease !== lease)
      throw new ShareError(409, "room_claim", "This turn is not owned by your computer.");
    if (turn.status !== "running" && turn.status !== "stopping") return;
    const cancelled = turn.status === "stopping" || !this.canParticipate(member) || paused;
    if (turn.execution === "owner") {
      const run = this.hostRuns.get(turn.roomId);
      if (run && !run.done) {
        this.abortRun(turn.roomId);
        throw new ShareError(409, "room_draining", "The owner session is still stopping.");
      }
      status = run?.status ?? "failed";
      reply = run?.reply ?? "";
      if (run?.workspace) this.fileTools.remove(run.workspace);
      this.hostRuns.delete(turn.roomId);
    }
    this.store.transition(turn, cancelled ? "cancelled" : status, cancelled ? "" : reply);
    this.pump(member.roomId, paused);
  }

  stop(member: RoomMember, id: string, paused: boolean): void {
    this.requireActive(member, paused);
    const turn = this.store.turn(member.roomId, id);
    if (!turn || (turn.authorId !== member.id && turn.runner !== member.id))
      throw new ShareError(403, "room_stop", "Only the author or runner can stop this turn.");
    if (turn.status === "queued") this.store.transition(turn, "cancelled");
    else if (turn.status === "running") {
      this.store.transition(turn, "stopping");
      this.abortRun(turn.roomId);
    }
    this.pump(member.roomId, paused);
  }

  sync(paused: boolean): void {
    if (this.closed) return;
    for (const [id, deadline] of this.ready) if (deadline <= this.now()) this.ready.delete(id);
    for (const { id } of this.store.busyRooms()) this.pump(id, paused);
  }

  async close(): Promise<void> {
    this.closed = true;
    const runs = [...this.hostRuns.values()];
    for (const [roomId] of this.hostRuns) this.abortRun(roomId);
    await Promise.all(runs.map((run) => run.complete));
    this.hostRuns.clear();
  }

  private requireActive(member: RoomMember, paused: boolean): void {
    if (this.closed || paused || !this.canParticipate(member))
      throw new ShareError(403, "inactive", "This room is paused or your invite has ended.");
  }

  private pump(roomId: string, paused: boolean): void {
    if (this.closed) return;
    let turn = this.store.head(roomId);
    while (turn) {
      const author = this.store.member(turn.authorId);
      const runner = turn.runner === "host" ? author : this.store.member(turn.runner);
      const blocked =
        paused ||
        !this.canParticipate(author) ||
        !this.canParticipate(runner) ||
        !this.modelEnabled(turn.model) ||
        !this.models.has(turn.model);
      if (turn.status === "stopping") return;
      if (turn.status === "running") {
        if (blocked) {
          this.store.transition(turn, "stopping");
          this.abortRun(roomId);
        }
        return;
      }
      if (paused) return;
      if (blocked || !this.models.has(turn.model)) {
        this.store.transition(turn, "cancelled");
        turn = this.store.head(roomId);
        continue;
      }
      if (turn.runner !== "host" || this.activeHostRuns() >= MAX_HOST_RUNS) return;
      const model = this.models.get(turn.model)!;
      if (this.store.activate(turn, null)) this.startHostRun(turn, model);
      return;
    }
  }

  private activeHostRuns(): number {
    return [...this.hostRuns.values()].filter((run) => !run.done).length;
  }

  private abortRun(roomId: string): void {
    const run = this.hostRuns.get(roomId);
    run?.workspace?.stop();
    run?.abort.abort();
  }

  fileRequests(member: RoomMember, id: string, lease: string, paused: boolean) {
    const status = this.leaseStatus(member, id, lease, paused);
    const turn = this.store.turn(member.roomId, id)!;
    if (turn.execution !== "owner" || turn.runner === "host")
      throw new ShareError(409, "room_claim", "This turn does not share files.");
    const run = this.hostRuns.get(turn.roomId);
    return {
      status: status === "cancelled" ? ("failed" as const) : status,
      requests: status === "running" ? (run?.workspace?.requests() ?? []) : [],
      providerDone: run?.done ?? true,
    };
  }

  fileResult(
    member: RoomMember,
    id: string,
    lease: string,
    requestId: string,
    result: ShareFileResult,
    paused: boolean,
  ): void {
    if (this.leaseStatus(member, id, lease, paused) !== "running") return;
    const turn = this.store.turn(member.roomId, id)!;
    if (turn.execution !== "owner")
      throw new ShareError(409, "room_claim", "This turn does not share files.");
    this.hostRuns.get(turn.roomId)?.workspace?.respond(requestId, result);
  }

  private startHostRun(
    turn: NonNullable<ReturnType<CodeShareRoomStore["head"]>>,
    model: ShareModel,
  ): void {
    const abort = new AbortController();
    const workspace = turn.runner !== "host" ? this.fileTools.create() : undefined;
    const run: HostRun = {
      abort,
      done: false,
      complete: Promise.resolve(),
      ...(workspace ? { workspace } : {}),
    };
    const complete = Promise.resolve()
      .then(async () => {
        let reply = "";
        let nextPublish = 0;
        let status: ShareRoomTurn["status"] = "complete";
        const timer = setTimeout(
          () => abort.abort(),
          workspace ? CODE_SHARE_REMOTE_TURN_TIMEOUT_MS : HOST_RUN_TIMEOUT_MS,
        ).unref();
        try {
          abort.signal.throwIfAborted();
          await this.runProvider({
            model,
            ...(workspace ? { remoteTools: workspace.bridge } : {}),
            messages: this.store.context(turn),
            signal: abort.signal,
            append: (text) => {
              abort.signal.throwIfAborted();
              if (this.store.turn(turn.roomId, turn.id)?.status === "stopping")
                throw new Error("Stopped");
              if (reply.length + text.length > MAX_REPLY_CHARS)
                throw new ShareError(413, "response_limit", "The reply exceeded the room limit.");
              reply += text;
              if (this.now() >= nextPublish) {
                this.store.transition(turn, "running", reply);
                nextPublish = this.now() + 350;
              }
            },
          });
          abort.signal.throwIfAborted();
        } catch {
          status = abort.signal.aborted ? "cancelled" : "failed";
        } finally {
          clearTimeout(timer);
          if (!workspace) this.hostRuns.delete(turn.roomId);
          if (workspace) {
            this.fileTools.remove(workspace);
            delete run.workspace;
          }
        }
        run.done = true;
        run.status = status;
        run.reply = status === "complete" ? reply : "";
        if (workspace) {
          const current = this.store.turn(turn.roomId, turn.id)!;
          this.store.transition(current, current.status, run.reply);
        } else this.store.transition(turn, status, run.reply);
      })
      .catch(this.onFailure);
    run.complete = complete;
    this.hostRuns.set(turn.roomId, run);
  }
}
