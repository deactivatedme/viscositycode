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
  ShareError,
} from "@/shared/codeShare";
import { ProviderFailure, type RunProvider, type TokenUsage } from "./providerTransport";
import { CodeShareStore, inviteStatus } from "./store";

const MAX_ACTIVE_TURNS = 4;
const TURN_TIMEOUT_MS = 180_000;
const POLICY_INTERVAL_MS = 250;
const SAVE_REPLY_INTERVAL_MS = 250;

interface ActiveTurn {
  id: string;
  abort: AbortController;
  completion: Promise<void>;
}

export class CodeShareService {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly models: Map<string, ShareModel>;
  private readonly timer: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly store: CodeShareStore,
    private readonly guestOrigin: string,
    models: ShareModel[],
    private readonly runProvider: RunProvider,
    private readonly now = Date.now,
    private readonly onFailure = () => {
      process.stderr.write(
        "CodeShare could not settle a turn in its database. Restart the service if the turn stays active.\n",
      );
    },
    private readonly inviteModels?: ReadonlySet<string>,
  ) {
    this.models = new Map(models.map((model) => [model.id, model]));
    this.timer = setInterval(() => {
      try {
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

  ownerState(): OwnerState {
    const serverNow = this.now();
    return {
      paused: this.store.paused,
      guestOrigin: this.guestOrigin,
      models: [...this.models.values()].filter((model) => this.canInvite(model.id)),
      invites: this.store.list(serverNow),
      serverNow,
    };
  }

  private canInvite(model: string): boolean {
    return this.models.has(model) && (this.inviteModels?.has(model) ?? true);
  }

  createInvite(input: CreateInvite): { code: string; url: string } {
    if (input.models.some((model) => !this.canInvite(model)))
      throw new ShareError(400, "unknown_model", "Select models configured on this host.");
    const { code } = this.store.create(input, this.now());
    return { code, url: `${this.guestOrigin}/#invite=${code}` };
  }

  setPaused(paused: boolean): void {
    this.store.setPaused(paused);
    if (paused) for (const turn of this.active.values()) turn.abort.abort("paused");
  }

  extend(id: string, minutes: number): void {
    this.store.extend(id, minutes, this.now());
  }

  revoke(id: string): void {
    this.store.revoke(id, this.now());
    this.active.get(id)?.abort.abort("revoked");
  }

  redeem(code: string, claim: string, current: string, browser = false): string {
    return this.store.redeem(
      code,
      claim,
      current,
      this.now(),
      browser
        ? (models) => {
            if (models.some((id) => this.models.get(id)?.execution === "guest-subscription"))
              throw new ShareError(
                409,
                "desktop_required",
                "Paste this invite into Join CodeShare in the ViscosityCode desktop app.",
              );
          }
        : undefined,
    );
  }

  guestState(session: string): GuestState {
    const invite = this.store.findSession(session);
    const serverNow = this.now();
    const status = inviteStatus(invite, serverNow, this.store.paused);
    const visible = status === "active" || status === "paused";
    const models = this.store.modelIds(invite).flatMap((id) => this.models.get(id) ?? []);
    return {
      serverNow,
      expiresAt: invite.expiresAt!,
      status,
      // Keep the positive numeric allowance for older app clients. New clients
      // use the additive unlimited flag for display. The timer always applies.
      ...(invite.turnLimit === 0
        ? { turnsRemaining: Number.MAX_SAFE_INTEGER, unlimitedTurns: true as const }
        : { turnsRemaining: invite.turnLimit - invite.turnsUsed }),
      models: visible ? models : [],
      turns: visible ? this.store.turns(invite.id) : [],
    };
  }

  reserveLocalLaunch(session: string, input: ReserveLocalLaunch): void {
    if (this.models.get(input.model)?.execution !== "guest-subscription")
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
    if (this.models.get(input.model)?.execution === "guest-subscription")
      throw new ShareError(
        409,
        "local_subscription",
        "Open this model in the ViscosityCode desktop app.",
      );
    const { inviteId, turn, messages } = this.store.reserveTurn(session, input, this.now(), () => {
      if (this.closed || this.active.size >= MAX_ACTIVE_TURNS)
        throw new ShareError(503, "host_busy", "The host is busy. Try again in a moment.");
      if (!this.models.has(input.model))
        throw new ShareError(
          409,
          "model_unavailable",
          "This model is unavailable. Pick another model.",
        );
    });
    if (!messages) return turn;
    const model = this.models.get(input.model)!;
    const abort = new AbortController();
    const completion = this.generate(inviteId, turn, model, messages, abort).catch(this.onFailure);
    this.active.set(inviteId, { id: turn.id, abort, completion });
    return turn;
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
    await Promise.all(pending.map((turn) => turn.completion));
    this.store.close();
  }

  private async generate(
    inviteId: string,
    turn: ChatTurn,
    model: ShareModel,
    messages: Parameters<RunProvider>[0]["messages"],
    abort: AbortController,
  ): Promise<void> {
    const signal = abort.signal;
    const timeout = setTimeout(() => abort.abort("provider_unavailable"), TURN_TIMEOUT_MS).unref();
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
      this.active.delete(inviteId);
      this.store.settle(turn.seq, reply, issue, signal.aborted || Boolean(issue && reply), usage);
    }
  }
}
