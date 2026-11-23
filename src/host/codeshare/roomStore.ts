import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ShareError, type ChatMessage } from "@/shared/codeShare";
import type { ShareRoomRef, ShareRoomTurn } from "@/shared/codeShareRoom";

const MAX_TURNS = 40;
const MAX_QUEUE = 12;
const MAX_CONTEXT = 48_000;

export interface RoomMember {
  id: string;
  roomId: string;
  label: string;
  models: string[];
  turnLimit: number;
  turnsUsed: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

interface RoomTurnRow extends ShareRoomTurn {
  seq: number;
  roomId: string;
  lease: string | null;
}

const memberSelect = `
  SELECT id, room_id AS roomId, label, models, turn_limit AS turnLimit,
    turns_used AS turnsUsed, expires_at AS expiresAt, revoked_at AS revokedAt
  FROM invites
`;
const turnSelect = `
  SELECT t.seq, t.request_id AS id, t.room_id AS roomId, t.author_id AS authorId,
    author.label AS authorName, t.runner, COALESCE(computer.label, 'Host') AS runnerName,
    t.model, t.prompt, t.reply, t.status, t.lease, t.execution
  FROM room_turns t
  JOIN invites author ON author.id = t.author_id
  LEFT JOIN invites computer ON computer.id = t.runner
`;

export function migrateCodeShareRooms(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE share_rooms (
        id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
      );
      ALTER TABLE invites ADD COLUMN room_id TEXT REFERENCES share_rooms (id);
      CREATE INDEX share_room_members ON invites (room_id);
      CREATE TABLE room_turns (
        seq INTEGER PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES share_rooms (id),
        request_id TEXT NOT NULL,
        author_id TEXT NOT NULL REFERENCES invites (id),
        runner TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        reply TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        lease TEXT,
        UNIQUE (room_id, request_id)
      );
      CREATE INDEX room_turn_order ON room_turns (room_id, seq);
      CREATE UNIQUE INDEX one_active_room_turn ON room_turns (room_id)
        WHERE status IN ('running', 'stopping');
      PRAGMA user_version = 2;
    `);
  })();
}

export class CodeShareRoomStore {
  constructor(private readonly db: Database.Database) {}

  recoverHostRuns(): void {
    const rooms = this.db
      .prepare<[], { id: string }>(`
      SELECT DISTINCT room_id AS id FROM room_turns
      WHERE (runner = 'host' OR execution = 'owner') AND status IN ('running','stopping')
    `)
      .all();
    this.db.exec(`UPDATE room_turns SET status='failed'
      WHERE runner='host' AND status IN ('running','stopping')`);
    this.db.exec(
      "UPDATE room_turns SET status='stopping' WHERE runner<>'host' AND execution='owner' AND status='running'",
    );
    for (const { id } of rooms) this.changed(id);
  }

  busyRooms(): { id: string }[] {
    return this.db
      .prepare<[], { id: string }>(`
      SELECT DISTINCT room_id AS id FROM room_turns WHERE status IN ('queued','running','stopping')
    `)
      .all();
  }

  create(label: string): ShareRoomRef {
    const id = randomUUID();
    this.db.prepare("INSERT INTO share_rooms (id, label) VALUES (?, ?)").run(id, label);
    return { id, label };
  }

  list(): ShareRoomRef[] {
    return this.db
      .prepare<[], ShareRoomRef>("SELECT id,label FROM share_rooms ORDER BY rowid DESC")
      .all();
  }

  room(id: string): (ShareRoomRef & { revision: number }) | undefined {
    return this.db
      .prepare<[string], ShareRoomRef & { revision: number }>(
        "SELECT id,label,revision FROM share_rooms WHERE id = ?",
      )
      .get(id);
  }

  assertInviteRoom(id: string, _now: number): void {
    if (!this.room(id)) throw new ShareError(404, "room_missing", "This room no longer exists.");
  }

  member(id: string): RoomMember | undefined {
    const row = this.db
      .prepare<[string], Omit<RoomMember, "models"> & { models: string }>(
        memberSelect + " WHERE id = ? AND room_id IS NOT NULL",
      )
      .get(id);
    return row ? { ...row, models: JSON.parse(row.models) as string[] } : undefined;
  }

  members(roomId: string, now: number, after = ""): { id: string; label: string }[] {
    return this.db
      .prepare<[string, number, string, string], { id: string; label: string }>(`
      SELECT id,label FROM invites
      WHERE room_id = ? AND revoked_at IS NULL AND expires_at > ?
      AND rowid > COALESCE((SELECT rowid FROM invites WHERE id = ? AND room_id = ?), 0)
      ORDER BY rowid LIMIT 101
    `)
      .all(roomId, now, after, roomId);
  }

  turns(roomId: string): ShareRoomTurn[] {
    const rows = this.db
      .prepare<[string, number], RoomTurnRow>(
        turnSelect + " WHERE t.room_id = ? ORDER BY t.seq DESC LIMIT ?",
      )
      .all(roomId, MAX_TURNS);
    const turns: ShareRoomTurn[] = [];
    let bytes = 0;
    for (const { seq: _seq, lease: _lease, roomId: _room, ...turn } of rows) {
      bytes += Buffer.byteLength(JSON.stringify(turn));
      if (bytes > 3 * 1024 * 1024) break;
      turns.push(turn);
    }
    return turns.reverse();
  }

  turn(roomId: string, id: string): RoomTurnRow | undefined {
    return this.db
      .prepare<[string, string], RoomTurnRow>(
        turnSelect + " WHERE t.room_id = ? AND t.request_id = ?",
      )
      .get(roomId, id);
  }

  head(roomId: string): RoomTurnRow | undefined {
    return this.db
      .prepare<[string], RoomTurnRow>(
        turnSelect +
          " WHERE t.room_id = ? AND t.status IN ('queued','running','stopping') ORDER BY t.seq LIMIT 1",
      )
      .get(roomId);
  }

  enqueue(
    member: RoomMember,
    input: { id: string; model: string; runner: string; prompt: string },
    execution: "owner" | "participant" = "participant",
  ): void {
    this.db
      .transaction(() => {
        const existing = this.turn(member.roomId, input.id);
        if (existing) {
          if (
            existing.authorId !== member.id ||
            existing.model !== input.model ||
            existing.prompt !== input.prompt ||
            existing.runner !== input.runner
          )
            throw new ShareError(409, "request_conflict", "This request ID is already in use.");
          return;
        }
        if (member.turnLimit > 0 && member.turnsUsed >= member.turnLimit)
          throw new ShareError(429, "turn_limit", "You reached the turn limit for this invite.");
        const queued =
          this.db
            .prepare<[string], { count: number }>(
              "SELECT COUNT(*) AS count FROM room_turns WHERE room_id = ? AND status = 'queued'",
            )
            .get(member.roomId)?.count ?? 0;
        if (queued >= MAX_QUEUE)
          throw new ShareError(409, "room_queue_full", "The room queue is full.");
        this.db
          .prepare(`
        INSERT INTO room_turns (room_id,request_id,author_id,runner,model,prompt,execution) VALUES (?,?,?,?,?,?,?)
      `)
          .run(
            member.roomId,
            input.id,
            member.id,
            input.runner,
            input.model,
            input.prompt,
            execution,
          );
        this.db
          .prepare("UPDATE invites SET turns_used = turns_used + 1 WHERE id = ?")
          .run(member.id);
        this.changed(member.roomId);
      })
      .immediate();
  }

  context(turn: RoomTurnRow): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: "user", content: turn.prompt }];
    let size = turn.prompt.length;
    const history = this.db
      .prepare<[string, number, number], { prompt: string; reply: string }>(`
      SELECT prompt,reply FROM room_turns WHERE room_id = ? AND seq < ?
      AND status = 'complete' AND reply <> '' ORDER BY seq DESC LIMIT ?
    `)
      .all(turn.roomId, turn.seq, MAX_TURNS);
    for (const row of history) {
      size += row.prompt.length + row.reply.length;
      if (size > MAX_CONTEXT) break;
      messages.unshift(
        { role: "user", content: row.prompt },
        { role: "assistant", content: row.reply },
      );
    }
    return messages;
  }

  activate(turn: RoomTurnRow, lease: string | null): boolean {
    const result = this.db
      .prepare("UPDATE room_turns SET status='running',lease=? WHERE seq=? AND status='queued'")
      .run(lease, turn.seq);
    if (result.changes) this.changed(turn.roomId);
    return result.changes === 1;
  }

  transition(turn: RoomTurnRow, status: ShareRoomTurn["status"], reply = turn.reply): void {
    this.db
      .prepare("UPDATE room_turns SET status=?,reply=? WHERE seq=?")
      .run(status, reply, turn.seq);
    this.changed(turn.roomId);
  }

  changed(roomId: string): void {
    this.db.prepare("UPDATE share_rooms SET revision = revision + 1 WHERE id = ?").run(roomId);
  }
}
