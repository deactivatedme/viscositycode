import { ShareFileToolGateway, type ShareFileWorkspace } from "./fileToolGateway";
import type { ShareFileResult } from "@/shared/codeShareFileTools";
import { CODE_SHARE_REMOTE_TURN_TIMEOUT_MS } from "@/shared/codeShareFileTools";
import {
  type ChatTurn,
  type CreateInvite,
  type GuestState,
  type OwnerState,
  type ReserveLocalLaunch,
  type ShareModel,
  type SubmitTurn,
  type TurnIssue,
  MAX_REPLY_CHARS,
  CODE_SHARE_PROJECT_PROTOCOL,
  ShareError,
} from "@/shared/codeShare";
import { ProviderFailure, type RunProvider, type TokenUsage } from "./providerTransport";
import { CodeShareRoomService } from "./roomService";
import type { RoomMember } from "./roomStore";
import { CodeShareStore, inviteStatus } from "./store";

const MAX_ACTIVE_TURNS = 4;
const TURN_TIMEOUT_MS = 180_000;
const POLICY_INTERVAL_MS = 250;
const SAVE_REPLY_INTERVAL_MS = 250;

interface ActiveTurn {
  id: string;
  model: string;
  projectThread?: string;
  workspace?: ShareFileWorkspace;
  abort: AbortController;
  completion: Promise<void>;
}

export class CodeShareService {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly models: Map<string, ShareModel>;
  private readonly timer: NodeJS.Timeout;
  readonly rooms: CodeShareRoomService;
  readonly fileTools = new ShareFileToolGateway();
  private closed = false;

  constructor(
    private readonly store: CodeShareStore,
    private guestOrigin: string,
    models: ShareModel[],
    private readonly runProvider: RunProvider,
    private readonly now = Date.now,
    private readonly onFailure = () => {
      process.stderr.write(
        "CodeShare could not settle a turn in its database. Restart the service if the turn stays active.\n",
      );
    },
    private readonly inviteModels?: ReadonlySet<string>,
    private readonly discoverModels?: () => Promise<ShareModel[]>,
  ) {
    store.bindOwnerModels(
      models
        .filter(
          (model) =>
            (model.execution === "owner-subscription" || model.remoteEditing) &&
            model.execution !== "guest-subscription",
        )
        .map(({ id }) => id),
      now(),
    );
    this.models = new Map(models.map((model) => [model.id, model]));
    this.rooms = new CodeShareRoomService(
      store.rooms,
      this.models,
      runProvider,
      now,
      onFailure,
      (id) => store.modelEnabled(id),
      this.fileTools,
    );
    this.timer = setInterval(() => {
      try {
        this.rooms.sync(this.store.paused);
        for (const [id, turn] of this.active) {
          const status = inviteStatus(this.store.findInvite(id), this.now(), this.store.paused);
          if (status === "expired" || status === "paused" || status === "revoked")
            turn.abort.abort(status);
        }
      } catch {
        this.onFailure();
        for (const turn of this.active.values()) turn.abort.abort("provider_unavailable");
      }
    }, POLICY_INTERVAL_MS).unref();
  }

  setGuestOrigin(origin: string): void {
    this.guestOrigin = origin;
  }

  ownerState(): OwnerState {
    const serverNow = this.now();
    return {
      paused: this.store.paused,
      guestOrigin: this.guestOrigin,
      models: [...this.models.values()],
      ...(this.inviteModels ? { inviteModels: [...this.inviteModels] } : {}),
      enabledModels: [...this.models.keys()].filter((id) => this.store.modelEnabled(id)),
      invites: this.store.list(serverNow),
      rooms: this.store.rooms.list(),
      serverNow,
    };
  }

  private canInvite(model: string): boolean {
    return this.models.has(model) && (this.inviteModels?.has(model) ?? true);
  }

  async refreshModels(): Promise<void> {
    if (!this.discoverModels) return;
    const discovered = await this.discoverModels();
    if (this.closed) return;
    this.store.bindOwnerModels(
      discovered
        .filter(
          (model) =>
            (model.execution === "owner-subscription" || model.remoteEditing) &&
            model.execution !== "guest-subscription",
        )
        .map(({ id }) => id),
      this.now(),
    );
    this.models.clear();
    for (const model of discovered) this.models.set(model.id, model);
    this.enforceModelPolicy();
  }

  setEnabledModels(ids: string[]): void {
    if (ids.some((id) => !this.models.has(id)))
      throw new ShareError(400, "unknown_model", "Select models configured on this host.");
    this.store.setEnabledModels([...this.models.keys()], new Set(ids));
    this.enforceModelPolicy();
  }

  private enforceModelPolicy(): void {
    for (const turn of this.active.values()) {
      if (!this.models.has(turn.model) || !this.store.modelEnabled(turn.model))
        turn.abort.abort("model_unavailable");
    }
    this.rooms.sync(this.store.paused);
  }

  createInvite(input: CreateInvite): { code: string; url: string } {
    if (input.models.some((model) => !this.canInvite(model) || !this.store.modelEnabled(model)))
      throw new ShareError(400, "unknown_model", "Select models configured on this host.");
    const now = this.now();
    if (input.roomId) this.store.rooms.assertInviteRoom(input.roomId, now);
    const { code } = this.store.create(input, now);
    return { code, url: `${this.guestOrigin}/#invite=${code}` };
  }

  createRoom(label: string) {
    return this.store.rooms.create(label);
  }

  get paused(): boolean {
    return this.store.paused;
  }

  roomMember(session: string): RoomMember {
    const invite = this.store.findSession(session);
    const member = invite.roomId ? this.store.rooms.member(invite.id) : undefined;
    if (!member) throw new ShareError(403, "room_required", "This invite does not join a room.");
    return member;
  }

  private requireDirectInvite(session: string): void {
    if (this.store.findSession(session).roomId)
      throw new ShareError(409, "room_required", "Send this prompt from the shared room.");
  }

  setPaused(paused: boolean): void {
    this.store.setPaused(paused);
    this.rooms.sync(paused);
    if (paused) for (const turn of this.active.values()) turn.abort.abort("paused");
  }

  extend(id: string, minutes: number): void {
    this.store.extend(id, minutes, this.now());
  }

  revoke(id: string): void {
    this.store.revoke(id, this.now());
    this.rooms.sync(this.store.paused);
    this.active.get(id)?.abort.abort("revoked");
  }

  redeem(
    code: string,
    claim: string,
    current: string,
    browser = false,
    supportsRooms = !browser,
    supportsProjects = !browser,
  ): string {
    return this.store.redeem(code, claim, current, this.now(), (models, roomId, desktopOnly) => {
      if (desktopOnly && (browser || (!roomId && !supportsProjects)))
        throw new ShareError(
          409,
          "desktop_required",
          "Open Join CodeShare in the current ViscosityCode desktop app to redeem this invite.",
        );
      if (roomId && !supportsRooms)
        throw new ShareError(
          409,
          "room_update_required",
          "Refresh this invite page or use a current version of the ViscosityCode desktop app.",
        );
      if (
        browser &&
        !roomId &&
        models.some((id) => this.models.get(id)?.execution === "guest-subscription")
      )
        throw new ShareError(
          409,
          "desktop_required",
          "Paste this invite into Join CodeShare in the ViscosityCode desktop app.",
        );
    });
  }

  guestState(session: string): GuestState {
    const invite = this.store.findSession(session);
    const serverNow = this.now();
    const status = inviteStatus(invite, serverNow, this.store.paused);
    const visible = status === "active" || status === "paused";
    const models = this.store
      .modelIds(invite)
      .flatMap((id) => (this.store.modelEnabled(id) ? (this.models.get(id) ?? []) : []));
    const room = invite.roomId ? this.store.rooms.room(invite.roomId) : undefined;
    return {
      serverNow,
      expiresAt: invite.expiresAt!,
      status,
      // Keep the positive numeric allowance for older app clients. New clients
      // use the additive unlimited flag for display. The timer always applies.
      ...(invite.turnLimit === 0
        ? { turnsRemaining: Number.MAX_SAFE_INTEGER, unlimitedTurns: true as const }
        : { turnsRemaining: invite.turnLimit - invite.turnsUsed }),
      // Owner-funded models use the existing hosted-chat wire shape. Older app
      // clients must send normal turns, never launch their own subscription.
      models: visible
        ? models.map((model) => {
            if (model.execution !== "owner-subscription") return model;
            const publicModel = { ...model };
            delete publicModel.execution;
            return publicModel;
          })
        : [],
      turns: visible ? this.store.turns(invite.id) : [],
      ...(room ? { room: { id: room.id, label: room.label } } : {}),
      ...(!room && models.some(({ execution }) => execution !== "guest-subscription")
        ? { projectProtocol: CODE_SHARE_PROJECT_PROTOCOL }
        : {}),
    };
  }

  reserveLocalLaunch(session: string, input: ReserveLocalLaunch): void {
    this.requireDirectInvite(session);
    if (
      !this.store.modelEnabled(input.model) ||
      this.models.get(input.model)?.execution !== "guest-subscription"
    )
      throw new ShareError(
        403,
        "model_denied",
        "This model does not accept local subscription launches.",
      );
    // An empty prompt is a durable launch receipt. Guest prompts and replies
    // never go through the share host in this mode.
    this.store.reserveTurn(session, { ...input, prompt: "" }, this.now(), () => {}, true);
  }

  submit(session: string, input: SubmitTurn): ChatTurn {
    return this.startTurn(session, input);
  }

  submitProject(session: string, input: SubmitTurn & { threadId: string }): ChatTurn {
    return this.startTurn(session, input, input.threadId);
  }

  private startTurn(session: string, input: SubmitTurn, projectThread?: string): ChatTurn {
    this.requireDirectInvite(session);
    const model = this.models.get(input.model);
    if (model?.execution === "guest-subscription")
      throw new ShareError(
        409,
        "local_subscription",
        "Open this model in the ViscosityCode desktop app.",
      );
    const reservation: { workspace?: ShareFileWorkspace } = {};
    const { inviteId, turn, messages } = (() => {
      try {
        return this.store.reserveTurn(
          session,
          input,
          this.now(),
          () => {
            if (this.closed || this.active.size >= MAX_ACTIVE_TURNS)
              throw new ShareError(503, "host_busy", "The host is busy. Try again in a moment.");
            if (!model || !this.store.modelEnabled(input.model))
              throw new ShareError(
                409,
                "model_unavailable",
                "This model is unavailable. Pick another model.",
              );
            if (projectThread && model.remoteEditing)
              reservation.workspace = this.fileTools.create();
          },
          false,
          projectThread,
        );
      } catch (error) {
        if (reservation.workspace) this.fileTools.remove(reservation.workspace);
        throw error;
      }
    })();
    if (!messages) return turn;
    const { workspace } = reservation;
    const abort = new AbortController();
    if (workspace) abort.signal.addEventListener("abort", () => workspace.stop(), { once: true });
    const completion = this.generate(inviteId, turn, model!, messages, abort, workspace).catch(
      this.onFailure,
    );
    this.active.set(inviteId, {
      id: turn.id,
      model: input.model,
      abort,
      completion,
      ...(projectThread ? { projectThread } : {}),
      ...(workspace ? { workspace } : {}),
    });
    return turn;
  }

  projectProgress(session: string, threadId: string, id: string) {
    const invite = this.store.findSession(session);
    const state = inviteStatus(invite, this.now(), this.store.paused);
    const turn = this.store.projectTurn(session, threadId, id);
    const active = this.active.get(invite.id);
    const matching = active?.id === id && active.projectThread === threadId;
    if (state !== "active") {
      if (matching) active.abort.abort(state);
      throw new ShareError(403, "inactive", "This share is paused or has ended.");
    }
    return {
      turn,
      requests: matching ? (active.workspace?.requests() ?? []) : [],
    };
  }

  projectFileResult(
    session: string,
    threadId: string,
    id: string,
    requestId: string,
    result: ShareFileResult,
  ): void {
    const { requests } = this.projectProgress(session, threadId, id);
    if (requests.some((request) => request.id === requestId))
      this.active.get(this.store.findSession(session).id)?.workspace?.respond(requestId, result);
  }

  stopProject(session: string, threadId: string, id: string): void {
    this.store.projectTurn(session, threadId, id);
    this.stop(session, id);
  }

  stop(session: string, id: string): void {
    const invite = this.store.findSession(session);
    const turn = this.active.get(invite.id);
    if (turn?.id === id) turn.abort.abort("stopped");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    const pending = [...this.active.values()];
    for (const turn of pending) turn.abort.abort("restarted");
    await Promise.all([this.rooms.close(), ...pending.map((turn) => turn.completion)]);
    this.fileTools.close();
    this.store.close();
  }

  private async generate(
    inviteId: string,
    turn: ChatTurn,
    model: ShareModel,
    messages: Parameters<RunProvider>[0]["messages"],
    abort: AbortController,
    workspace?: ShareFileWorkspace,
  ): Promise<void> {
    const signal = abort.signal;
    const timeout = setTimeout(
      () => abort.abort("provider_unavailable"),
      workspace ? CODE_SHARE_REMOTE_TURN_TIMEOUT_MS : TURN_TIMEOUT_MS,
    ).unref();
    let reply = "";
    let issue: TurnIssue | null = null;
    let usage: TokenUsage | null = null;
    let lastSaved = 0;
    try {
      // Schedule generation after installing the active-turn entry, even for a
      // provider that throws synchronously.
      await Promise.resolve();
      signal.throwIfAborted();
      usage = await this.runProvider({
        model,
        ...(workspace ? { remoteTools: workspace.bridge } : {}),
        messages,
        signal,
        append: (chunk) => {
          signal.throwIfAborted();
          if (reply.length + chunk.length > MAX_REPLY_CHARS) {
            reply += chunk.slice(0, MAX_REPLY_CHARS - reply.length);
            abort.abort("response_limit");
            signal.throwIfAborted();
          }
          reply += chunk;
          const now = this.now();
          if (now - lastSaved >= SAVE_REPLY_INTERVAL_MS) {
            this.store.saveReply(turn.seq, reply);
            lastSaved = now;
          }
        },
      });
      signal.throwIfAborted();
    } catch (error) {
      issue = signal.aborted
        ? (signal.reason as TurnIssue)
        : error instanceof ProviderFailure
          ? error.issue
          : "provider_unavailable";
    } finally {
      clearTimeout(timeout);
      if (workspace) this.fileTools.remove(workspace);
      this.active.delete(inviteId);
      this.store.settle(turn.seq, reply, issue, signal.aborted || Boolean(issue && reply), usage);
    }
  }
}
