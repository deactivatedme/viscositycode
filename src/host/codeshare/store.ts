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

import { CodeShareRoomStore, migrateCodeShareRooms } from "./roomStore";

const MINUTE_MS = 60_000;
const MAX_CONTEXT_CHARS = 48_000;
const HISTORY_TURNS = 12;

// CodeShare has its own database and v1 HTTP surface. Neither reads nor
// migrates the app database. Refuse unfamiliar schema versions before writing.
// v3 adds owner model policy. Existing grants remain valid, except a legacy
// guest-funded grant must never silently become an owner-funded grant.
export const CODESHARE_DATABASE_VERSION = 6;

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
  roomId: string | null;
  desktopOnly: 0 | 1;
}

const inviteColumns = `
  id, label, models, duration_minutes AS durationMinutes, redeem_by AS redeemBy,
  expires_at AS expiresAt, revoked_at AS revokedAt, turn_limit AS turnLimit,
  turns_used AS turnsUsed, room_id AS roomId, desktop_only AS desktopOnly
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
  readonly rooms: CodeShareRoomStore;

  constructor(path: string) {
    this.db = new Database(path, resolveBetterSqliteNativeBindingOptions());
    try {
      const version = this.db.pragma("user_version", { simple: true });
      if (
        version !== 0 &&
        version !== 1 &&
        version !== 2 &&
        version !== 3 &&
        version !== 4 &&
        version !== 5 &&
        version !== CODESHARE_DATABASE_VERSION
      )
        throw new Error("This CodeShare database format is unsupported.");
      if (version === 0) this.initialize();
      if (version === 0 || version === 1) migrateCodeShareRooms(this.db);
      if (Number(version) < 3)
        this.db.transaction(() => {
          this.db.exec(
            `CREATE TABLE model_policy (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, owner_bound INTEGER NOT NULL DEFAULT 0); PRAGMA user_version = 3;`,
          );
        })();
      if (Number(version) < 4)
        this.db.transaction(() => {
          this.db.exec(
            "ALTER TABLE room_turns ADD COLUMN execution TEXT NOT NULL DEFAULT 'participant'; PRAGMA user_version = 4;",
          );
        })();
      if (Number(version) < 5)
        this.db.transaction(() => {
          this.db.exec(`
            ALTER TABLE room_turns ADD COLUMN input_tokens INTEGER;
            ALTER TABLE room_turns ADD COLUMN output_tokens INTEGER;
            CREATE INDEX room_turns_by_author ON room_turns (author_id);
            PRAGMA user_version = 5;
          `);
        })();
      if (Number(version) < 6)
        this.db.transaction(() => {
          this.db.exec(`
            ALTER TABLE turns ADD COLUMN project_thread TEXT;
            ALTER TABLE invites ADD COLUMN desktop_only INTEGER NOT NULL DEFAULT 0;
            CREATE INDEX code_share_turns_by_thread ON turns (invite_id, project_thread, seq);
            PRAGMA user_version = 6;
          `);
        })();
      this.rooms = new CodeShareRoomStore(this.db);
      this.rooms.recoverHostRuns();
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
        PRAGMA user_version = 1;
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

  modelEnabled(id: string): boolean {
    const row = this.db
      .prepare<[string], { enabled: number }>("SELECT enabled FROM model_policy WHERE id = ?")
      .get(id);
    return row === undefined || row.enabled === 1;
  }

  setEnabledModels(models: readonly string[], enabled: ReadonlySet<string>): void {
    this.db.transaction(() => {
      const write = this.db.prepare(
        "INSERT INTO model_policy (id, enabled) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled",
      );
      for (const id of models) write.run(id, Number(enabled.has(id)));
    })();
  }

  bindOwnerModels(ids: readonly string[], now: number): void {
    this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db
          .prepare<[string], { owner_bound: number }>(
            "SELECT owner_bound FROM model_policy WHERE id = ?",
          )
          .get(id);
        if (row?.owner_bound === 1) continue;
        // Old grants only authorized guest-funded launches under this ID.
        for (const invite of this.list(now))
          if (invite.models.includes(id)) this.revoke(invite.id, now);
        this.db
          .prepare(
            "INSERT INTO model_policy (id, enabled, owner_bound) VALUES (?, 1, 1) ON CONFLICT(id) DO UPDATE SET owner_bound=1",
          )
          .run(id);
      }
    })();
  }

  list(now: number): InviteView[] {
    const paused = this.paused;
    return this.db
      .prepare<
        [],
        InviteRow & { inputTokens: number; outputTokens: number; reportedUsageTurns: number }
      >(`
      SELECT ${inviteColumns},
        COALESCE((SELECT SUM(input_tokens) FROM turns WHERE invite_id = invites.id), 0)
          + COALESCE((SELECT SUM(input_tokens) FROM room_turns WHERE author_id = invites.id), 0) AS inputTokens,
        COALESCE((SELECT SUM(output_tokens) FROM turns WHERE invite_id = invites.id), 0)
          + COALESCE((SELECT SUM(output_tokens) FROM room_turns WHERE author_id = invites.id), 0) AS outputTokens,
        (SELECT COUNT(input_tokens) FROM turns WHERE invite_id = invites.id)
          + (SELECT COUNT(input_tokens) FROM room_turns WHERE author_id = invites.id) AS reportedUsageTurns
      FROM invites ORDER BY rowid DESC
    `)
      .all()
      .map(({ models, revokedAt, roomId, desktopOnly, ...invite }) => ({
        ...invite,
        ...(roomId ? { roomId } : {}),
        models: JSON.parse(models) as string[],
        status: inviteStatus({ ...invite, models, revokedAt, roomId, desktopOnly }, now, paused),
      }));
  }

  create(input: CreateInvite, now: number): { id: string; code: string } {
    const id = randomUUID();
    const code = shareSecret(16);
    this.db
      .prepare(`
      INSERT INTO invites (id, label, code_hash, duration_minutes, redeem_by, turn_limit, models, room_id, desktop_only)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        id,
        input.label,
        digest(code),
        input.durationMinutes,
        now + input.redeemWithinMinutes * MINUTE_MS,
        input.turnLimit,
        JSON.stringify([...new Set(input.models)]),
        input.roomId ?? null,
        input.desktopOnly ? 1 : 0,
      );
    return { id, code };
  }

  redeem(
    code: string,
    claim: string,
    current: string,
    now: number,
    checkClient?: (models: string[], roomId: string | null, desktopOnly: boolean) => void,
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
        checkClient?.(this.modelIds(invite), invite.roomId, invite.desktopOnly === 1);
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

  turns(id: string, projectThread: string | null = null): ChatTurn[] {
    return this.db
      .prepare<[string, string | null, number], ChatTurn>(
        `SELECT ${turnColumns} FROM turns
         WHERE invite_id = ? AND project_thread IS ? AND prompt <> '' ORDER BY seq DESC LIMIT ?`,
      )
      .all(id, projectThread, HISTORY_TURNS)
      .reverse();
  }

  projectTurn(session: string, threadId: string, id: string): ChatTurn {
    const invite = this.findSession(session);
    const turn = this.db
      .prepare<[string, string, string], ChatTurn>(
        `SELECT ${turnColumns} FROM turns WHERE invite_id = ? AND project_thread = ? AND request_id = ?`,
      )
      .get(invite.id, threadId, id);
    if (!turn) throw new ShareError(404, "turn_missing", "This shared project turn was not found.");
    return turn;
  }

  reserveTurn(
    session: string,
    input: SubmitTurn,
    now: number,
    checkCapacity: () => void,
    localAdmission = false,
    projectThread: string | null = null,
  ): { inviteId: string; turn: ChatTurn; messages: ChatMessage[] | null } {
    return this.db
      .transaction(() => {
        const invite = this.findSession(session);
        if (inviteStatus(invite, now, this.paused) !== "active")
          throw new ShareError(403, "inactive", "This share is paused or has ended.");
        const existing = this.db
          .prepare<[string, string], ChatTurn & { projectThread: string | null }>(
            `SELECT ${turnColumns}, project_thread AS projectThread FROM turns WHERE invite_id = ? AND request_id = ?`,
          )
          .get(invite.id, input.id);
        if (existing) {
          if (
            existing.prompt !== input.prompt ||
            existing.model !== input.model ||
            existing.projectThread !== projectThread
          )
            throw new ShareError(409, "request_conflict", "This request ID was already used.");
          const { projectThread: _projectThread, ...turn } = existing;
          return { inviteId: invite.id, turn, messages: null };
        }
        if (!this.modelIds(invite).includes(input.model))
          throw new ShareError(403, "model_denied", "This model is outside your invite.");
        const history = localAdmission ? [] : this.turns(invite.id, projectThread);
        if (
          this.db
            .prepare("SELECT 1 FROM turns WHERE invite_id=? AND status='running'")
            .get(invite.id)
        )
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
          .prepare<[string, string, string, string, string, string | null], ChatTurn>(`
        INSERT INTO turns (invite_id, request_id, model, prompt, status, project_thread) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING ${turnColumns}
      `)
          .get(
            invite.id,
            input.id,
            input.model,
            input.prompt,
            localAdmission ? "complete" : "running",
            projectThread,
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
