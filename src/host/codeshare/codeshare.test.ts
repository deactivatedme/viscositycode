import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInviteSchema,
  parseModel,
  type GuestState,
  type OwnerState,
} from "@/shared/codeShare";
import { startCodeShareHttp } from "./http";
import { CodeShareStore, shareSecret } from "./store";
import { CodeShareService } from "./service";
import type { RunProvider } from "./providerTransport";

const openai = parseModel("openai:test-model");
const anthropic = parseModel("anthropic:test-model");
const dirs: string[] = [];
const cleanup: Array<() => Promise<void>> = [];

function scratch(): string {
  mkdirSync("tmp", { recursive: true });
  const path = mkdtempSync("tmp/codeshare-test-");
  dirs.push(path);
  return path;
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function cookie(response: Response, name: string): string {
  const value = response.headers.getSetCookie().find((header) => header.startsWith(name + "="));
  return value?.split(";")[0] ?? "";
}

function httpRequest(
  origin: string,
  path: string,
  data?: object,
  headers: Record<string, string> = {},
  method = data ? "POST" : "GET",
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(origin + path, { method, headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const responseHeaders = new Headers();
        for (const [key, values] of Object.entries(incoming.headers)) {
          for (const value of Array.isArray(values) ? values : values ? [values] : []) {
            responseHeaders.append(key, value);
          }
        }
        resolve(
          new Response(chunks.length ? Buffer.concat(chunks) : null, {
            status: incoming.statusCode!,
            headers: responseHeaders,
          }),
        );
      });
    });
    req.on("error", reject);
    req.end(data ? JSON.stringify(data) : undefined);
  });
}

async function createHarness(
  provider: RunProvider,
  options: {
    path?: string;
    guestOrigin?: string;
    models?: ReturnType<typeof parseModel>[];
    setup?: import("./setupService").CodeShareOwnerSetup;
  } = {},
) {
  const guestPort = await freePort();
  const localGuest = `http://127.0.0.1:${guestPort}`;
  const guestOrigin = options.guestOrigin ?? localGuest;
  const databasePath = options.path ?? join(scratch(), "share.sqlite");
  const ownerToken = shareSecret();
  let now = Date.now();
  const store = new CodeShareStore(databasePath);
  const service = new CodeShareService(
    store,
    guestOrigin,
    options.models ?? [openai, anthropic],
    provider,
    () => now,
  );
  const httpOptions: import("./http").CodeShareHttpOptions = {
    adminPort: 0,
    guestPort,
    guestOrigin,
    ownerToken,
    service,
    ...(options.setup ? { setup: options.setup } : {}),
    healthNonce: "fixture-public-health",
  };
  const http = await startCodeShareHttp(httpOptions);
  const close = async () => {
    await http.close();
    await service.close();
  };
  cleanup.push(close);
  const req = (origin: string, path: string, data?: object, auth?: string) => {
    const guest = origin === localGuest;
    const configuredOrigin = guest ? guestOrigin : origin;
    return httpRequest(origin, path, data, {
      Host: new URL(configuredOrigin).host,
      ...(data ? { "Content-Type": "application/json", Origin: configuredOrigin } : {}),
      ...(auth ? (guest ? { Cookie: auth } : { Authorization: auth }) : {}),
    });
  };
  const owner = (path: string, data?: object, auth?: string) =>
    req(http.ownerOrigin, path, data, auth);
  const guest = (path: string, data?: object, auth?: string) => req(localGuest, path, data, auth);
  const login = async () => {
    const auth = "Bearer " + ownerToken;
    const response = await owner("/api/v1/owner", undefined, auth);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    return auth;
  };
  return {
    owner,
    guest,
    localGuest,
    login,
    service,
    databasePath,
    httpOptions,
    close,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const invite = createInviteSchema.parse({
  label: "Guest",
  models: [openai.id],
  durationMinutes: 5,
  redeemWithinMinutes: 2,
  turnLimit: 1,
});
const createTurn = (model = openai.id) => ({ id: randomUUID(), model, prompt: "test prompt" });

const complete: RunProvider = async ({ append }) => {
  append("test reply");
  return { inputTokens: 7, outputTokens: 5 };
};

function delayedProvider(): RunProvider {
  return ({ signal, append }) =>
    new Promise((_resolve, reject) => {
      append("partial reply");
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

describe("CodeShare private and public HTTP", () => {
  it("redeems one browser, recovers a lost response, and enforces permissions and quotas", async () => {
    const runProvider = vi.fn<RunProvider>(complete);
    const host = await createHarness(runProvider);
    expect((await host.owner("/api/v1/owner")).status).toBe(401);
    const owner = await host.login();
    expect(
      (await httpRequest(host.localGuest, "/api/v1/owner", undefined, { Authorization: owner }))
        .status,
    ).toBe(404);
    expect((await host.owner("/api/v1/session", undefined, owner)).status).toBe(404);
    const created = await host.owner("/api/v1/owner/invites", invite, owner);
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    const claims = await Promise.all([host.guest("/"), host.guest("/")]);
    const claimA = cookie(claims[0]!, "codeshare_claim");
    const claimB = cookie(claims[1]!, "codeshare_claim");
    const redeems = await Promise.all(
      [claimA, claimB].map((claim) => host.guest("/api/v1/redeem", { code }, claim)),
    );
    expect(redeems.map((response) => response.status).sort()).toEqual([200, 404]);
    const winnerIndex = redeems.findIndex((response) => response.ok);
    const winner = redeems[winnerIndex]!;
    const session = cookie(winner, "codeshare_guest");
    const initial = (await winner.json()) as GuestState;
    expect(initial.expiresAt - initial.serverNow).toBe(300_000);
    host.advance(20_000);
    const recovery = await host.guest("/api/v1/redeem", { code }, winnerIndex ? claimB : claimA);
    expect(cookie(recovery, "codeshare_guest")).toBe(session);
    expect(((await recovery.json()) as GuestState).expiresAt).toBe(initial.expiresAt);
    expect((await host.guest("/api/v1/turns", createTurn(anthropic.id), session)).status).toBe(403);
    const input = createTurn();
    const receipts = await Promise.all(
      [input, input, createTurn()].map((turn) => host.guest("/api/v1/turns", turn, session)),
    );
    expect(receipts.map((response) => response.status).sort()).toEqual([202, 202, 429]);
    expect(runProvider).toHaveBeenCalledTimes(1);
    const result = (await (
      await host.guest("/api/v1/session", undefined, session)
    ).json()) as GuestState;
    expect(result.turns).toMatchObject([{ reply: "test reply", status: "complete" }]);
    expect(result.turnsRemaining).toBe(0);
    const other = host.service.createInvite(invite);
    const unrelated = await host.guest(
      "/api/v1/redeem",
      { code: other.code },
      winnerIndex ? claimA : claimB,
    );
    expect(((await unrelated.json()) as GuestState).turns).toEqual([]);
  });

  it("preserves unlimited and legacy limited invites across a host restart", async () => {
    const first = await createHarness(complete);
    const owner = await first.login();
    first.service.createInvite(invite);
    const created = await first.owner("/api/v1/owner/invites", { ...invite, turnLimit: 0 }, owner);
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    const claim = cookie(await first.guest("/"), "codeshare_claim");
    const redeemed = await first.guest("/api/v1/redeem", { code }, claim);
    const session = cookie(redeemed, "codeshare_guest");
    expect(await redeemed.json()).toMatchObject({
      unlimitedTurns: true,
      turnsRemaining: Number.MAX_SAFE_INTEGER,
    });
    expect((await first.guest("/api/v1/turns", createTurn(), session)).status).toBe(202);
    await first.close();

    const second = await createHarness(complete, { path: first.databasePath });
    expect((await second.guest("/api/v1/turns", createTurn(), session)).status).toBe(202);
    expect(
      second.service.ownerState().invites.map(({ turnLimit, turnsUsed }) => [turnLimit, turnsUsed]),
    ).toEqual([
      [0, 2],
      [1, 0],
    ]);
    second.advance(300_001);
    expect((await second.guest("/api/v1/turns", createTurn(), session)).status).toBe(403);
  });

  it("uses an explicit bearer for app guests and preserves browser-origin protections", async () => {
    const host = await createHarness(complete);
    const { code } = host.service.createInvite(invite);
    const appHeaders = { Origin: "null", "Content-Type": "application/json" };
    const app = (path: string, data?: object, token?: string) =>
      httpRequest(host.localGuest, "/api/v1/app" + path, data, {
        ...appHeaders,
        ...(token ? { Authorization: "Bearer " + token } : {}),
      });
    const preflight = await httpRequest(
      host.localGuest,
      "/api/v1/app/turns",
      undefined,
      { Origin: "null" },
      "OPTIONS",
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const originalClaim = (await (await app("/claim", {})).json()) as { claim: string };
    const forged = await app("/redeem", {
      code,
      claim: originalClaim.claim.replace(/\.[^.]+$/u, "." + "A".repeat(43)),
    });
    expect(forged.status).toBe(409);
    const redeemed = await app("/redeem", { code, claim: originalClaim.claim });
    expect(redeemed.status).toBe(200);
    expect(redeemed.headers.getSetCookie()).toEqual([]);
    const { token, state } = (await redeemed.json()) as { token: string; state: GuestState };
    const replay = await app("/redeem", { code, claim: originalClaim.claim });
    expect(await replay.json()).toMatchObject({ token, state: { expiresAt: state.expiresAt } });
    const another = (await (await app("/claim", {})).json()) as { claim: string };
    expect((await app("/redeem", { code, claim: another.claim })).status).toBe(404);
    const cookieOnly = await httpRequest(host.localGuest, "/api/v1/app/session", undefined, {
      Origin: "null",
      Cookie: "codeshare_guest=" + token,
    });
    expect(cookieOnly.status).toBe(401);
    const browserCrossOrigin = await httpRequest(
      host.localGuest,
      "/api/v1/turns",
      createTurn(),
      appHeaders,
    );
    expect(browserCrossOrigin.status).toBe(403);
    expect(browserCrossOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await app("/turns", createTurn(anthropic.id), token)).status).toBe(403);
    expect((await app("/turns", createTurn(), token)).status).toBe(202);
    expect((await app("/session", undefined, token)).status).toBe(200);
    expect((await app("/owner", undefined, token)).status).toBe(404);
  });

  it("admits guest subscription launches on desktop without sharing prompts or credentials", async () => {
    const local = { ...parseModel("codex:gpt-6"), execution: "guest-subscription" as const };
    const provider = vi.fn<RunProvider>(complete);
    const host = await createHarness(provider, { models: [openai, local] });
    const { code } = host.service.createInvite({ ...invite, models: [local.id] });
    const claim = cookie(await host.guest("/"), "codeshare_claim");
    expect((await host.guest("/api/v1/redeem", { code }, claim)).status).toBe(409);
    const app = (path: string, data?: object, token?: string) =>
      httpRequest(host.localGuest, "/api/v1/app" + path, data, {
        Origin: "null",
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      });
    const appClaim = (await (await app("/claim", {})).json()) as { claim: string };
    expect((await app("/redeem", { code, claim: appClaim.claim })).status).toBe(409);
    const redeemed = await app("/redeem?desktop=1", { code, claim: appClaim.claim });
    expect(redeemed.status).toBe(200);
    const { token, state } = (await redeemed.json()) as { token: string; state: GuestState };
    expect(state.models).toEqual([local]);
    expect((await app("/turns", createTurn(local.id), token)).status).toBe(409);
    const input = { id: randomUUID(), model: local.id };
    expect((await app("/local-launch", { ...input, prompt: "private" }, token)).status).toBe(400);
    expect((await app("/local-launch", input, token)).status).toBe(200);
    expect((await app("/local-launch", input, token)).status).toBe(200);
    expect((await app("/local-launch", { ...input, id: randomUUID() }, token)).status).toBe(429);
    expect(await (await app("/session", undefined, token)).json()).toMatchObject({
      turnsRemaining: 0,
      turns: [],
    });
    host.service.setPaused(true);
    expect((await app("/local-launch", input, token)).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it("throttles repeated invite requests before reading the body and keeps the owner dashboard reachable", async () => {
    const host = await createHarness(complete);
    const headers = { Origin: "null", "Content-Type": "application/json" };
    for (let i = 0; i < 12; i++) {
      expect((await httpRequest(host.localGuest, "/api/v1/app/redeem", {}, headers)).status).toBe(
        400,
      );
    }
    const blocked = await httpRequest(host.localGuest, "/api/v1/app/redeem", {}, headers);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await blocked.json()).toMatchObject({ error: "guest_rate_limited" });
    expect(await host.login()).toBeTruthy();
  });

  it("keeps owner actions private and checks Host and Origin on the public listener", async () => {
    const host = await createHarness(complete, { guestOrigin: "https://share.example.test" });
    const created = host.service.createInvite(invite);
    const page = await host.guest("/");
    expect(page.status).toBe(200);
    const cookieHeader = page.headers.getSetCookie()[0]!;
    expect(cookieHeader).toMatch(/^__Host-codeshare_claim=/u);
    expect(cookieHeader).toContain("HttpOnly; SameSite=Strict; Secure");
    const claim = cookie(page, "__Host-codeshare_claim");
    const redeemed = await host.guest("/api/v1/redeem", { code: created.code }, claim);
    expect(cookie(redeemed, "__Host-codeshare_guest")).toBeTruthy();
    const owner = await host.login();
    const ownerState = (await (
      await host.owner("/api/v1/owner", undefined, owner)
    ).json()) as OwnerState;
    expect(JSON.stringify(ownerState)).not.toContain(created.code);
    expect(ownerState.invites[0]?.status).toBe("active");
    const badOrigin = await httpRequest(
      host.localGuest,
      "/api/v1/redeem",
      {},
      {
        Host: "share.example.test",
        Origin: "https://other.example.test",
      },
    );
    expect(badOrigin.status).toBe(403);
    expect((await httpRequest(host.localGuest, "/")).status).toBe(421);
  });

  it("extends, pauses and revokes access across clients with server time", async () => {
    const host = await createHarness(delayedProvider());
    const owner = await host.login();
    const initial = host.service.createInvite({ ...invite, turnLimit: 4 });
    const claim = cookie(await host.guest("/"), "codeshare_claim");
    const response = await host.guest("/api/v1/redeem", { code: initial.code }, claim);
    const session = cookie(response, "codeshare_guest");
    const active = (await response.json()) as GuestState;
    const id = host.service.ownerState().invites[0]!.id;
    expect(
      (await host.owner(`/api/v1/owner/invites/${id}/extend`, { minutes: 10 }, owner)).ok,
    ).toBe(true);
    expect(host.service.guestState(session.split("=")[1]!).expiresAt).toBe(
      active.expiresAt + 600_000,
    );
    expect((await host.guest("/api/v1/turns", createTurn(), session)).status).toBe(202);
    expect((await host.owner("/api/v1/owner/pause", { paused: true }, owner)).ok).toBe(true);
    expect(host.service.guestState(session.split("=")[1]!).turns[0]).toMatchObject({
      reply: "partial reply",
      status: "interrupted",
      issue: "paused",
    });
    expect((await host.guest("/api/v1/turns", createTurn(), session)).status).toBe(403);
    await host.owner("/api/v1/owner/pause", { paused: false }, owner);
    expect((await host.guest("/api/v1/turns", createTurn(), session)).status).toBe(202);
    host.advance(900_000);
    expect((await host.guest("/api/v1/turns", createTurn(), session)).status).toBe(403);
    await vi.waitFor(() => {
      const db = new Database(host.databasePath, { readonly: true });
      try {
        expect(
          db.prepare("SELECT issue, status FROM turns ORDER BY seq DESC LIMIT 1").get(),
        ).toEqual({ issue: "expired", status: "interrupted" });
      } finally {
        db.close();
      }
    });
    await host.owner(`/api/v1/owner/invites/${id}/revoke`, {}, owner);
    expect(host.service.guestState(session.split("=")[1]!)).toMatchObject({
      status: "revoked",
      turns: [],
    });
  });

  it("retains grants, interrupted answers, and consumed turns over a restart", async () => {
    const first = await createHarness(delayedProvider());
    const created = first.service.createInvite(invite);
    const claim = cookie(await first.guest("/"), "codeshare_claim");
    const response = await first.guest("/api/v1/redeem", { code: created.code }, claim);
    const session = cookie(response, "codeshare_guest");
    const expiresAt = ((await response.json()) as GuestState).expiresAt;
    const turn = createTurn();
    expect((await first.guest("/api/v1/turns", turn, session)).status).toBe(202);
    await first.close();
    // Model an unclean restart with a durable partial write left running.
    const db = new Database(first.databasePath);
    db.prepare("UPDATE turns SET status = 'running', issue = NULL").run();
    db.close();
    const second = await createHarness(complete, { path: first.databasePath });
    const state = (await (
      await second.guest("/api/v1/session", undefined, session)
    ).json()) as GuestState;
    expect(state).toMatchObject({
      expiresAt,
      turnsRemaining: 0,
      turns: [{ status: "interrupted", issue: "restarted", reply: "partial reply" }],
    });
  });

  it("refuses a future database without rewriting its schema", () => {
    const file = join(scratch(), "future.sqlite");
    const db = new Database(file);
    db.exec("PRAGMA user_version = 100");
    db.close();
    expect(() => new CodeShareStore(file)).toThrow("unsupported");
    const preserved = new Database(file, { readonly: true });
    try {
      expect(preserved.pragma("user_version", { simple: true })).toBe(100);
      expect(preserved.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    } finally {
      preserved.close();
    }
  });
});

it("shares owner subscriptions through browser chat and persists model policy across restart", async () => {
  const model = { ...parseModel("codex:owner-model"), execution: "owner-subscription" as const };
  const run = vi.fn<RunProvider>(complete);
  const host = await createHarness(run, { models: [model] });
  const auth = await host.login();
  const { code } = host.service.createInvite({ ...invite, models: [model.id], turnLimit: 5 });
  const claim = cookie(await host.guest("/"), "codeshare_claim");
  const response = await host.guest("/api/v1/redeem", { code }, claim);
  expect(response.status).toBe(200);
  // Previous app readers accept this ordinary hosted-chat model shape.
  expect(await response.json()).toMatchObject({ models: [{ id: model.id }] });
  const session = cookie(response, "codeshare_guest");
  expect((await host.guest("/api/v1/turns", createTurn(model.id), session)).status).toBe(202);
  expect((await host.owner("/api/v1/owner/models", { models: [] }, auth)).status).toBe(200);
  expect((await host.guest("/api/v1/turns", createTurn(model.id), session)).status).toBe(409);
  expect(
    (await host.owner("/api/v1/owner/invites", { ...invite, models: [model.id] }, auth)).status,
  ).toBe(400);
  const state = await (await host.guest("/api/v1/session", undefined, session)).json();
  expect(state.models).toEqual([]);
  expect(run).toHaveBeenCalledTimes(1);
  await host.close();
  const restarted = await createHarness(run, { path: host.databasePath, models: [model] });
  expect(restarted.service.ownerState().enabledModels).toEqual([]);
  expect((await restarted.guest("/api/v1/turns", createTurn(model.id), session)).status).toBe(409);
});

it("revokes a v2 guest-funded grant before first enabling owner billing under its model ID", async () => {
  const path = join(scratch(), "v2.sqlite");
  const prior = new CodeShareStore(path);
  const legacy = { ...invite, models: ["codex:owner-model"] };
  prior.create(legacy, Date.now());
  prior.close();
  const v2 = new Database(path);
  v2.exec(
    "DROP TABLE model_policy; ALTER TABLE room_turns DROP COLUMN execution; PRAGMA user_version=2",
  );
  v2.close();
  const model = { ...parseModel("codex:owner-model"), execution: "owner-subscription" as const };
  const host = await createHarness(complete, { path, models: [model] });
  expect(host.service.ownerState().invites[0]?.status).toBe("revoked");
  host.service.createInvite({ ...invite, models: [model.id] });
  await host.close();
  const next = await createHarness(complete, { path, models: [model] });
  expect(next.service.ownerState().invites.map(({ status }) => status)).toEqual([
    "pending",
    "revoked",
  ]);
});

it("lets current guest browsers join shared rooms while old browser clients refuse before redemption", async () => {
  const funded = { ...parseModel("claude:room-owner"), execution: "owner-subscription" as const };
  const host = await createHarness(complete, { models: [funded] });
  const room = host.service.createRoom("Shared coding");
  const { code } = host.service.createInvite({
    ...invite,
    models: [funded.id],
    roomId: room.id,
    turnLimit: 5,
  });
  const claim = cookie(await host.guest("/"), "codeshare_claim");
  expect((await host.guest("/api/v1/redeem", { code }, claim)).status).toBe(409);
  const accepted = await host.guest("/api/v1/redeem?rooms=2", { code }, claim);
  expect(accepted.status).toBe(200);
  const session = cookie(accepted, "codeshare_guest");
  expect(await accepted.json()).toMatchObject({ room });
  const turn = { ...createTurn(funded.id), runner: "host", protocolVersion: 2 };
  expect((await host.guest("/api/v1/room", undefined, session)).status).toBe(409);
  const { protocolVersion: _version, ...legacyTurn } = turn;
  expect((await host.guest("/api/v1/room/turns", legacyTurn, session)).status).toBe(400);
  expect((await host.guest("/api/v1/room/turns", turn, session)).status).toBe(200);
  await vi.waitFor(async () => {
    const snapshot = await (
      await host.guest("/api/v1/room?roomProtocol=2", undefined, session)
    ).json();
    expect(snapshot.turns).toMatchObject([
      { authorName: "Guest", runner: "host", reply: "test reply", status: "complete" },
    ]);
  });
  expect((await host.guest("/api/v1/turns", createTurn(funded.id), session)).status).toBe(409);
  host.service.setEnabledModels([]);
  expect(
    (await host.guest("/api/v1/room/turns", { ...turn, id: randomUUID() }, session)).status,
  ).toBe(403);
});

it("keeps setup credentials on the owner listener and applies live HTTPS cookie and Host policies", async () => {
  const snapshot = vi.fn<() => Promise<unknown>>(async () => ({
    subscriptions: [],
    apiKeys: [{ id: "cursor", configured: true }],
    cloudflare: { connected: false },
  }));
  const saveKey = vi.fn<(input: unknown) => Promise<void>>(async () => {});
  const setup = { snapshot, saveKey } as unknown as import("./setupService").CodeShareOwnerSetup;
  const host = await createHarness(complete, { setup });
  expect((await host.owner("/api/v1/owner/setup")).status).toBe(401);
  expect((await host.guest("/api/v1/owner/setup")).status).toBe(404);
  expect(snapshot).not.toHaveBeenCalled();
  const auth = await host.login();
  expect((await host.owner("/api/v1/owner/setup", undefined, auth)).status).toBe(200);
  const keyInput = { action: "save", provider: "cursor", key: "private-key-fixture", models: [] };
  const saved = await host.owner("/api/v1/owner/setup/keys", keyInput, auth);
  expect(saved.status).toBe(200);
  expect(JSON.stringify(await saved.json())).not.toContain("private-key-fixture");
  expect(saveKey).toHaveBeenCalledWith(keyInput);
  host.httpOptions.guestOrigin = "https://share.example.test";
  host.httpOptions.trustCloudflareClientIp = true;
  host.service.setGuestOrigin(host.httpOptions.guestOrigin);
  const page = await httpRequest(host.localGuest, "/", undefined, { Host: "share.example.test" });
  expect(page.headers.getSetCookie()[0]).toContain("__Host-codeshare_claim=");
  expect(page.headers.getSetCookie()[0]).toContain("Secure");
  expect((await httpRequest(host.localGuest, "/")).status).toBe(421);
  const health = await httpRequest(host.localGuest, "/.well-known/codeshare-health", undefined, {
    Host: "share.example.test",
  });
  expect(await health.json()).toEqual({ nonce: "fixture-public-health" });
  expect(host.service.createInvite(invite).url).toMatch(/^https:\/\/share.example.test\//u);
});
