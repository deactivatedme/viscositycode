import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { parseModel } from "@/shared/codeShare";
import { CodeShareService } from "./service";
import { CodeShareStore, shareSecret } from "./store";
import type { RunProvider } from "./providerTransport";

const hosted = parseModel("xai:grok-demo");
const remote = {
  ...parseModel("codex:owner-fixture"),
  execution: "owner-subscription" as const,
  remoteEditing: true as const,
};
const local = {
  ...parseModel("claude:claude-fable-5-2"),
  execution: "guest-subscription" as const,
};

function setup(run: RunProvider) {
  const root = mkdtempSync(join(tmpdir(), "codeshare-room-"));
  const file = join(root, "share.sqlite");
  let now = 1_000_000_000;
  let service = attach();
  function attach() {
    return new CodeShareService(
      new CodeShareStore(file),
      "https://example.test",
      [hosted, local, remote],
      run,
      () => now,
    );
  }
  function member(roomId: string, label: string, models = [hosted.id, local.id]) {
    const { code } = service.createInvite({
      label,
      roomId,
      models,
      durationMinutes: 10,
      redeemWithinMinutes: 60,
      turnLimit: 0,
    });
    const token = shareSecret();
    expect(() => service.redeem(code, token, "", true)).toThrow("desktop app");
    service.redeem(code, token, "");
    return { token, member: service.roomMember(token) };
  }
  return {
    file,
    get service() {
      return service;
    },
    member,
    advance(ms: number) {
      now += ms;
    },
    async restart() {
      await service.close();
      service = attach();
    },
    async close() {
      try {
        await service.close();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

it("isolates room invites and queues several participants behind a single computer lease", async () => {
  const run = vi.fn<RunProvider>(async ({ append }) => {
    append("Hosted reply");
    return { inputTokens: 5, outputTokens: 2 };
  });
  const test = setup(run);
  const service = test.service;
  try {
    const room = service.createRoom("Team");
    const a = test.member(room.id, "Alex");
    const b = test.member(room.id, "Bea");
    const c = test.member(room.id, "Cam");
    const other = test.member(service.createRoom("Other").id, "Drew");
    service.rooms.setReady(b.member, true);
    service.rooms.setReady(c.member, true);
    const first = { id: randomUUID(), model: local.id, prompt: "First", runner: b.member.id };
    const second = { id: randomUUID(), model: local.id, prompt: "Second", runner: c.member.id };
    const third = { id: randomUUID(), model: hosted.id, prompt: "Third", runner: "host" };
    expect(service.guestState(a.token).room).toEqual(room);
    expect(() => service.submit(a.token, first)).toThrow("shared room");
    expect(() => service.rooms.submit(other.member, first, false)).toThrow("ready participant");
    service.rooms.submit(a.member, first, false);
    service.rooms.submit(a.member, first, false);
    service.rooms.submit(b.member, second, false);
    service.rooms.submit(c.member, third, false);
    const lease = randomUUID();
    expect(() => service.rooms.claim(c.member, second.id, lease, false)).toThrow("no longer ready");
    expect(service.rooms.claim(b.member, first.id, lease, false)).toEqual({
      execution: "participant",
      id: first.id,
      model: local.id,
      prompt: "First",
      history: [],
    });
    expect(() => service.rooms.claim(b.member, first.id, randomUUID(), false)).toThrow(
      "no longer ready",
    );
    expect(service.rooms.claim(b.member, first.id, lease, false).id).toBe(first.id);
    expect(service.rooms.snapshot(a.member, undefined, false).turns).toMatchObject([
      { authorName: "Alex", runnerName: "Bea", status: "running" },
      { authorName: "Bea", runnerName: "Cam", status: "queued" },
      { authorName: "Cam", runnerName: "Host", status: "queued" },
    ]);
    expect(service.rooms.snapshot(other.member, undefined, false).turns).toEqual([]);
    expect(run).not.toHaveBeenCalled();

    service.rooms.stop(a.member, first.id, false);
    expect(service.rooms.leaseStatus(b.member, first.id, lease)).toBe("stopping");
    expect(() => service.rooms.claim(c.member, second.id, lease, false)).toThrow("no longer ready");
    service.rooms.finish(b.member, first.id, lease, "complete", "Late reply", false);
    service.rooms.claim(c.member, second.id, lease, false);
    service.rooms.finish(c.member, second.id, lease, "complete", "Second reply", false);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const snapshot = service.rooms.snapshot(c.member, undefined, false);
    expect(snapshot.turns).toMatchObject([
      { status: "cancelled", reply: "" },
      { status: "complete", reply: "Second reply" },
      { status: "complete", reply: "Hosted reply" },
    ]);
    expect(service.rooms.snapshot(a.member, snapshot.revision, false).turns).toBeUndefined();
  } finally {
    await test.close();
  }
});

it("holds the queue after a restart until a revoked worker settles its existing lease", async () => {
  const run = vi.fn<RunProvider>(async () => ({ inputTokens: 0, outputTokens: 0 }));
  const test = setup(run);
  try {
    const room = test.service.createRoom("Team");
    const author = test.member(room.id, "Alex");
    const runner = test.member(room.id, "Bea");
    const first = { id: randomUUID(), model: local.id, prompt: "Work", runner: runner.member.id };
    const next = { id: randomUUID(), model: hosted.id, prompt: "After work", runner: "host" };
    const lease = randomUUID();
    test.service.rooms.setReady(runner.member, true);
    test.service.rooms.submit(author.member, first, false);
    test.service.rooms.claim(runner.member, first.id, lease, false);
    test.service.rooms.submit(author.member, next, false);
    await test.restart();
    const service = test.service;
    service.revoke(runner.member.id);
    const currentRunner = service.roomMember(runner.token);
    expect(() => service.rooms.snapshot(currentRunner, undefined, false)).toThrow("ended");
    expect(service.rooms.leaseStatus(currentRunner, first.id, lease)).toBe("stopping");
    expect(run).not.toHaveBeenCalled();
    service.rooms.finish(currentRunner, first.id, lease, "cancelled", "", false);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  } finally {
    await test.close();
  }
});

it("migrates a version 1 database without replacing its existing invite", () => {
  const root = mkdtempSync(join(tmpdir(), "codeshare-room-upgrade-"));
  const file = join(root, "share.sqlite");
  try {
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE share_settings (id INTEGER PRIMARY KEY, paused INTEGER NOT NULL);
      INSERT INTO share_settings VALUES (1, 0);
      CREATE TABLE invites (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, code_hash TEXT UNIQUE, session_hash TEXT UNIQUE,
        models TEXT NOT NULL, duration_minutes INTEGER NOT NULL, redeem_by INTEGER NOT NULL,
        expires_at INTEGER, revoked_at INTEGER, turn_limit INTEGER NOT NULL,
        turns_used INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE turns (
        seq INTEGER PRIMARY KEY, invite_id TEXT NOT NULL, request_id TEXT NOT NULL,
        model TEXT NOT NULL, prompt TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running', issue TEXT,
        input_tokens INTEGER, output_tokens INTEGER, UNIQUE (invite_id, request_id)
      );
      INSERT INTO invites (id,label,models,duration_minutes,redeem_by,turn_limit)
      VALUES ('released-invite','Existing invite','["xai:grok-demo"]',60,1000,2);
      PRAGMA user_version = 1;
    `);
    legacy.close();
    const store = new CodeShareStore(file);
    try {
      expect(store.list(500)).toMatchObject([
        { id: "released-invite", status: "pending", models: [hosted.id], turnLimit: 2 },
      ]);
      const room = store.rooms.create("New room");
      expect(store.rooms.list()).toEqual([room]);
      expect(store.list(500)[0]?.roomId).toBeUndefined();
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("preserves a pre-v4 participant lease and its invites during migration", async () => {
  const test = setup(async () => null);
  try {
    const room = test.service.createRoom("Migration");
    const a = test.member(room.id, "A");
    test.service.rooms.setReady(a.member, true);
    const turn = {
      id: randomUUID(),
      model: local.id,
      prompt: "existing work",
      runner: a.member.id,
    };
    const lease = randomUUID();
    test.service.rooms.submit(a.member, turn, false);
    test.service.rooms.claim(a.member, turn.id, lease, false);
    await test.service.close();
    const previous = new Database(test.file);
    previous.exec("ALTER TABLE room_turns DROP COLUMN execution; PRAGMA user_version=3");
    previous.close();
    await test.restart();
    const member = test.service.roomMember(a.token);
    expect(test.service.rooms.leaseStatus(member, turn.id, lease)).toBe("running");
    expect(test.service.rooms.snapshot(member, undefined, false).turns?.[0]).toMatchObject({
      execution: "participant",
      prompt: "existing work",
    });
    test.service.rooms.finish(member, turn.id, lease, "complete", "preserved", false);
    expect(test.service.ownerState().invites).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("recovers an owner-funded file lease as stopping and holds the next turn for local confirmation", async () => {
  const entered = Promise.withResolvers<void>();
  const test = setup(async ({ signal }) => {
    entered.resolve();
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    signal.throwIfAborted();
    return null;
  });
  try {
    test.service.fileTools.setOrigin("http://127.0.0.1:8788");
    const room = test.service.createRoom("Recovery");
    const a = test.member(room.id, "A", [remote.id]);
    test.service.rooms.setReady(a.member, true);
    const turn = { id: randomUUID(), model: remote.id, prompt: "Remote work", runner: a.member.id };
    const lease = randomUUID();
    test.service.rooms.submit(a.member, turn, false);
    test.service.rooms.submit(a.member, { ...turn, id: randomUUID(), prompt: "Next" }, false);
    test.service.rooms.claim(a.member, turn.id, lease, false);
    await entered.promise;
    expect(() => test.service.rooms.finish(a.member, turn.id, lease, "failed", "", false)).toThrow(
      "still stopping",
    );
    await test.restart();
    const member = test.service.roomMember(a.token);
    expect(test.service.rooms.fileRequests(member, turn.id, lease, false)).toMatchObject({
      status: "stopping",
      providerDone: true,
      requests: [],
    });
    expect(
      test.service.rooms.snapshot(member, undefined, false).turns?.map((item) => item.status),
    ).toEqual(["stopping", "queued"]);
    test.service.rooms.finish(member, turn.id, lease, "complete", "client text", false);
    expect(
      test.service.rooms.snapshot(member, undefined, false).turns?.map((item) => item.status),
    ).toEqual(["cancelled", "queued"]);
  } finally {
    await test.close();
  }
});

it("keeps disconnected file fences without exhausting provider capacity for other rooms", async () => {
  const test = setup(async ({ append }) => {
    append("Provider finished");
    return null;
  });
  try {
    test.service.fileTools.setOrigin("http://127.0.0.1:8788");
    for (let index = 0; index < 5; index++) {
      const room = test.service.createRoom(`Room ${index}`);
      const seat = test.member(room.id, "Runner", [remote.id]);
      test.service.rooms.setReady(seat.member, true);
      const turn = { id: randomUUID(), model: remote.id, prompt: "work", runner: seat.member.id };
      const lease = randomUUID();
      test.service.rooms.submit(seat.member, turn, false);
      expect(test.service.rooms.claim(seat.member, turn.id, lease, false).execution).toBe("owner");
      await vi.waitFor(() =>
        expect(
          test.service.rooms.fileRequests(seat.member, turn.id, lease, false).providerDone,
        ).toBe(true),
      );
      expect(test.service.rooms.snapshot(seat.member, undefined, false).turns?.[0]?.status).toBe(
        "running",
      );
    }
  } finally {
    await test.close();
  }
});
