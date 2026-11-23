import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { resolveBetterSqliteNativeBindingOptions } from "@/host/db/nativeBinding";
import {
  type ChatMessage,
  type ChatTurn,
  type CreateInvite,
  type InviteStatus,
  type InviteView,
  type SubmitTurn,
  type TurnIssue,
  ShareError,
} from "@/shared/codeShare";

const MINUTE_MS = 60_000;
const MAX_CONTEXT_CHARS = 48_000;
const HISTORY_TURNS = 12;

// CodeShare has its own database and v1 HTTP surface. Neither reads nor
// migrates the app database. Refuse unfamiliar schema versions before writing.
export const CODESHARE_DATABASE_VERSION = 1;

interface InviteRow {
  id: string;
  label: string;
  models: string;
  durationMinutes: number;
  redeemBy: number;
  expiresAt: number | null;
  revokedAt: number | null;
  turnLimit: number;
  turnsUsed: number;
}

const inviteColumns = `
  id, label, models, duration_minutes AS durationMinutes, redeem_by AS redeemBy,
  expires_at AS expiresAt, revoked_at AS revokedAt, turn_limit AS turnLimit,
  turns_used AS turnsUsed
`;
const turnColumns = `
  seq, request_id AS id, model, prompt, reply, status, issue,
  input_tokens AS inputTokens, output_tokens AS outputTokens
`;

export function shareSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function digest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function inviteStatus(invite: InviteRow, now: number, paused: boolean): InviteStatus {
  if (invite.revokedAt !== null) return "revoked";
  if (now >= (invite.expiresAt ?? invite.redeemBy)) return "expired";
  if (paused) return "paused";
  return invite.expiresAt === null ? "pending" : "active";
}

export class CodeShareStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path, resolveBetterSqliteNativeBindingOptions());
    try {
      const version = this.db.pragma("user_version", { simple: true });
      if (version === 0) this.initialize();
      else if (version !== CODESHARE_DATABASE_VERSION)
        throw new Error("This CodeShare database format is unsupported.");
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("journal_mode = WAL");
      this.db.exec(
        "UPDATE turns SET status = 'interrupted', issue = 'restarted' WHERE status = 'running'",
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private initialize(): void {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE share_settings (id INTEGER PRIMARY KEY CHECK (id = 1), paused INTEGER NOT NULL);
        INSERT INTO share_settings (id, paused) VALUES (1, 0);
        CREATE TABLE invites (
          id TEXT PRIMARY KEY NOT NULL,
          label TEXT NOT NULL,
          code_hash TEXT UNIQUE,
          session_hash TEXT UNIQUE,
          models TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          redeem_by INTEGER NOT NULL,
          expires_at INTEGER,
          revoked_at INTEGER,
          turn_limit INTEGER NOT NULL,
          turns_used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE turns (
          seq INTEGER PRIMARY KEY,
          invite_id TEXT NOT NULL REFERENCES invites (id),
          request_id TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt TEXT NOT NULL,
          reply TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'running',
          issue TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          UNIQUE (invite_id, request_id)
        );
        CREATE INDEX turns_by_invite ON turns (invite_id, seq);
        CREATE UNIQUE INDEX one_running_turn_per_invite ON turns (invite_id) WHERE status = 'running';
        PRAGMA user_version = ${CODESHARE_DATABASE_VERSION};
      `);
    })();
  }

  close(): void {
    this.db.close();
  }

  get paused(): boolean {
    return Boolean(
      this.db
        .prepare<[], { paused: number }>("SELECT paused FROM share_settings WHERE id = 1")
        .get()?.paused,
    );
  }

  setPaused(paused: boolean): void {
    this.db.prepare("UPDATE share_settings SET paused = ? WHERE id = 1").run(Number(paused));
  }

  list(now: number): InviteView[] {
    const paused = this.paused;
    return this.db
      .prepare<[], InviteRow & { inputTokens: number; outputTokens: number }>(`
      SELECT ${inviteColumns},
        COALESCE((SELECT SUM(input_tokens) FROM turns WHERE invite_id = invites.id), 0) AS inputTokens,
        COALESCE((SELECT SUM(output_tokens) FROM turns WHERE invite_id = invites.id), 0) AS outputTokens
      FROM invites ORDER BY rowid DESC
    `)
      .all()
      .map(({ models, revokedAt, ...invite }) => ({
        ...invite,
        models: JSON.parse(models) as string[],
        status: inviteStatus({ ...invite, models, revokedAt }, now, paused),
      }));
  }

  create(input: CreateInvite, now: number): { id: string; code: string } {
    const id = randomUUID();
    const code = shareSecret(16);
    this.db
      .prepare(`
      INSERT INTO invites (id, label, code_hash, duration_minutes, redeem_by, turn_limit, models)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        id,
        input.label,
        digest(code),
        input.durationMinutes,
        now + input.redeemWithinMinutes * MINUTE_MS,
        input.turnLimit,
        JSON.stringify([...new Set(input.models)]),
      );
    return { id, code };
  }

  redeem(
    code: string,
    claim: string,
    current: string,
    now: number,
    checkBrowser?: (models: string[]) => void,
  ): string {
    return this.db
      .transaction(() => {
        const invite = this.db
          .prepare<[string], InviteRow & { sessionHash: string | null }>(
            `SELECT ${inviteColumns}, session_hash AS sessionHash FROM invites WHERE code_hash = ?`,
          )
          .get(digest(code));
        const status = invite && inviteStatus(invite, now, false);
        const invalid = () =>
          new ShareError(404, "invalid_code", "This code is invalid, expired, or already used.");
        if (!invite || (status !== "pending" && status !== "active")) throw invalid();
        checkBrowser?.(this.modelIds(invite));
        if (status === "active") {
          // If the browser lost its redemption response, the original claim
          // cookie can recover the same session without starting a new timer.
          if (invite.sessionHash === digest(claim)) return claim;
          if (current && invite.sessionHash === digest(current)) return current;
          throw invalid();
        }
        if (this.paused) throw new ShareError(423, "paused", "The host has paused CodeShare.");
        const claimHash = digest(claim);
        if (this.db.prepare("SELECT 1 FROM invites WHERE session_hash = ?").get(claimHash))
          throw new ShareError(
            409,
            "redemption_conflict",
            "Another invite was just redeemed in this browser. Try again.",
          );
        this.db
          .prepare("UPDATE invites SET session_hash = ?, expires_at = ? WHERE id = ?")
          .run(claimHash, now + invite.durationMinutes * MINUTE_MS, invite.id);
        return claim;
      })
      .immediate();
  }

  findSession(session: string): InviteRow {
    const invite = this.db
      .prepare<[string], InviteRow>(`SELECT ${inviteColumns} FROM invites WHERE session_hash = ?`)
      .get(digest(session));
    if (!invite) throw new ShareError(401, "guest_session", "Enter an invite code to continue.");
    return invite;
  }

  findInvite(id: string): InviteRow {
    const invite = this.db
      .prepare<[string], InviteRow>(`SELECT ${inviteColumns} FROM invites WHERE id = ?`)
      .get(id);
    if (!invite) throw new ShareError(404, "unknown_invite", "This invite no longer exists.");
    return invite;
  }

  extend(id: string, minutes: number, now: number): void {
    const invite = this.findInvite(id);
    const status = inviteStatus(invite, now, false);
    if (status === "revoked" || status === "expired")
      throw new ShareError(409, "not_active", "This invite has already ended.");
    const extra = minutes * MINUTE_MS;
    if (invite.expiresAt === null) {
      this.db
        .prepare("UPDATE invites SET redeem_by = ? WHERE id = ?")
        .run(invite.redeemBy + extra, id);
    } else {
      this.db
        .prepare("UPDATE invites SET expires_at = ? WHERE id = ?")
        .run(invite.expiresAt + extra, id);
    }
  }

  revoke(id: string, now: number): void {
    this.findInvite(id);
    this.db
      .prepare(
        "UPDATE invites SET revoked_at = COALESCE(revoked_at, ?), code_hash = NULL WHERE id = ?",
      )
      .run(now, id);
  }

  modelIds(invite: InviteRow): string[] {
    return JSON.parse(invite.models) as string[];
  }

  turns(id: string): ChatTurn[] {
    return this.db
      .prepare<[string, number], ChatTurn>(
        `SELECT ${turnColumns} FROM turns WHERE invite_id = ? AND prompt <> '' ORDER BY seq DESC LIMIT ?`,
      )
      .all(id, HISTORY_TURNS)
      .reverse();
  }

  reserveTurn(
    session: string,
    input: SubmitTurn,
    now: number,
    checkCapacity: () => void,
    localAdmission = false,
  ): { inviteId: string; turn: ChatTurn; messages: ChatMessage[] | null } {
    return this.db
      .transaction(() => {
        const invite = this.findSession(session);
        if (inviteStatus(invite, now, this.paused) !== "active")
          throw new ShareError(403, "inactive", "This share is paused or has ended.");
        const existing = this.db
          .prepare<[string, string], ChatTurn>(
            `SELECT ${turnColumns} FROM turns WHERE invite_id = ? AND request_id = ?`,
          )
          .get(invite.id, input.id);
        if (existing) {
          if (existing.prompt !== input.prompt || existing.model !== input.model)
            throw new ShareError(409, "request_conflict", "This request ID was already used.");
          return { inviteId: invite.id, turn: existing, messages: null };
        }
        if (!this.modelIds(invite).includes(input.model))
          throw new ShareError(403, "model_denied", "This model is outside your invite.");
        const history = localAdmission ? [] : this.turns(invite.id);
        if (history.some((turn) => turn.status === "running"))
          throw new ShareError(
            409,
            "turn_running",
            "Wait for the current response or stop it first.",
          );
        if (invite.turnLimit > 0 && invite.turnsUsed >= invite.turnLimit)
          throw new ShareError(429, "turn_limit", "You've reached the turn limit for this invite.");
        checkCapacity();
        const messages: ChatMessage[] = [{ role: "user", content: input.prompt }];
        let contextChars = input.prompt.length;
        for (const turn of history.toReversed()) {
          if (turn.status !== "complete" || !turn.reply) continue;
          contextChars += turn.prompt.length + turn.reply.length;
          if (contextChars > MAX_CONTEXT_CHARS) break;
          messages.unshift(
            { role: "user", content: turn.prompt },
            { role: "assistant", content: turn.reply },
          );
        }
        const turn = this.db
          .prepare<[string, string, string, string, string], ChatTurn>(`
        INSERT INTO turns (invite_id, request_id, model, prompt, status) VALUES (?, ?, ?, ?, ?)
        RETURNING ${turnColumns}
      `)
          .get(
            invite.id,
            input.id,
            input.model,
            input.prompt,
            localAdmission ? "complete" : "running",
          )!;
        this.db
          .prepare("UPDATE invites SET turns_used = turns_used + 1 WHERE id = ?")
          .run(invite.id);
        return { inviteId: invite.id, turn, messages };
      })
      .immediate();
  }

  saveReply(seq: number, reply: string): void {
    this.db
      .prepare("UPDATE turns SET reply = ? WHERE seq = ? AND status = 'running'")
      .run(reply, seq);
  }

  settle(
    seq: number,
    reply: string,
    issue: TurnIssue | null,
    interrupted: boolean,
    usage: { inputTokens: number; outputTokens: number } | null,
  ): void {
    this.db
      .prepare(`
      UPDATE turns SET reply = ?, status = ?, issue = ?, input_tokens = ?, output_tokens = ?
      WHERE seq = ? AND status = 'running'
    `)
      .run(
        reply,
        interrupted ? "interrupted" : issue ? "failed" : "complete",
        issue,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        seq,
      );
  }
}
