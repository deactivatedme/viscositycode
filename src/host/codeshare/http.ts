import { CODE_SHARE_ROOM_PROTOCOL, shareFileReplySchema } from "@/shared/codeShareFileTools";
import { setupBrowser } from "./ui/setupBrowser";
import { shareApiKeySchema, shareHostnameSchema } from "@/shared/codeShareSetup";
import type { CodeShareOwnerSetup } from "./setupService";
import { roomBrowser } from "./ui/roomBrowser";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { readBoundedNodeRequestBody } from "@/shared/http";
import {
  appRedeemSchema,
  CODE_SHARE_APP_PATH,
  codeSchema,
  createInviteSchema,
  MAX_DURATION_MINUTES,
  modelIdSchema,
  reserveLocalLaunchSchema,
  ShareError,
  shareSecretSchema,
  stopTurnSchema,
  submitTurnSchema,
  submitRoomTurnSchema,
} from "@/shared/codeShare";
import {
  roomClaimSchema,
  roomCreateSchema,
  roomFinishSchema,
  roomProgressSchema,
  roomReadySchema,
} from "@/shared/codeShareRoom";
import { listCodeShareSubscriptionProviders } from "@/shared/codeShareSubscriptionProviders";
import { createAppClaims } from "./appClaim";
import { createGuestRateLimiter, GuestRateLimitError } from "./guestRateLimit";
import type { CodeShareService } from "./service";
import { shareSecret } from "./store";
import { ownerBrowser, type CodeShareOwnerProviderGroup } from "./ui/ownerBrowser";
import { listCodeShareHostedProviders } from "./providers";
import { guestBrowser } from "./ui/guestBrowser";
import { guestPage, ownerPage, style } from "./ui/pages";

const codeBody = z.strictObject({ code: codeSchema });
const pauseBody = z.strictObject({ paused: z.boolean() });
const extendBody = z.strictObject({ minutes: z.number().int().min(1).max(MAX_DURATION_MINUTES) });

export interface CodeShareHttpOptions {
  adminPort: number;
  guestPort: number;
  guestOrigin: string;
  ownerToken: string;
  service: CodeShareService;
  trustCloudflareClientIp?: boolean;
  setup?: CodeShareOwnerSetup;
  healthNonce?: string;
}

type Route = (request: IncomingMessage, response: ServerResponse, path: string) => Promise<void>;

function readCookie(req: IncomingMessage, name: string): string {
  const prefix = `${name}=`;
  const value = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return shareSecretSchema.safeParse(value).success ? value! : "";
}

function setCookie(
  res: ServerResponse,
  name: string,
  secret: string,
  secure: boolean,
  lifetime?: number,
): void {
  const value = `${name}=${secret}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}${
    lifetime === undefined ? "" : `; Max-Age=${lifetime}`
  }`;
  res.appendHeader("Set-Cookie", value);
}

function matchOwner(authorization: string | undefined, ownerToken: string): boolean {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "")?.[1];
  return token !== undefined && timingSafeEqual(Buffer.from(token), Buffer.from(ownerToken));
}

async function body<T>(
  req: IncomingMessage,
  schema: z.ZodType<T>,
  maxBytes = 128 * 1024,
): Promise<T> {
  if (req.headers["content-type"]?.split(";")[0]?.toLowerCase() !== "application/json")
    throw new ShareError(415, "content_type", "Send an application/json request.");
  const buffer = await readBoundedNodeRequestBody(
    req,
    maxBytes,
    () => new ShareError(413, "too_large", "This request is too large."),
  );
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ShareError(400, "invalid_json", "This request is malformed.");
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ShareError(400, "invalid_input", "Check the values you entered and try again.");
  return result.data;
}

function send(res: ServerResponse, status: number, contentType: string, text: string): void {
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function json(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(data));
}

function notFound(): never {
  throw new ShareError(404, "not_found", "Page not found.");
}

function staticPage(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  page: string,
  script: string,
): boolean {
  if (req.method !== "GET") return false;
  switch (path) {
    case "/":
      send(res, 200, "text/html; charset=utf-8", page);
      return true;
    case "/style.css":
      send(res, 200, "text/css; charset=utf-8", style);
      return true;
    case "/client.js":
      send(res, 200, "text/javascript; charset=utf-8", script);
      return true;
    default:
      return false;
  }
}

function createListener(
  origin: () => string,
  route: Route,
  guest?: { appRoutes: Route; trustCloudflareClientIp: boolean | (() => boolean) },
  runtimeTools?: (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>,
): Server {
  const limit = guest ? createGuestRateLimiter(guest.trustCloudflareClientIp) : undefined;
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    void (async () => {
      const expected = new URL(origin());
      if (req.headers.host !== expected.host)
        throw new ShareError(
          421,
          "invalid_host",
          "This host does not match the CodeShare address.",
        );
      const url = new URL(req.url ?? "/", expected);
      if (url.origin !== expected.origin) notFound();
      if (runtimeTools && (await runtimeTools(req, res, url.pathname))) return;
      if (expected.protocol === "https:")
        res.setHeader("Strict-Transport-Security", "max-age=31536000");
      if (guest && url.pathname.startsWith(CODE_SHARE_APP_PATH + "/")) {
        // App clients carry explicit bearer credentials. These routes never
        // use browser cookies or owner authorization, even on loopback.
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "Retry-After");
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "600",
          });
          res.end();
          return;
        }
        limit?.(req, url.pathname);
        await guest.appRoutes(req, res, url.pathname.slice(CODE_SHARE_APP_PATH.length));
        return;
      }
      if (req.method !== "GET" && (req.method !== "POST" || req.headers.origin !== expected.origin))
        throw new ShareError(403, "invalid_origin", "Open CodeShare directly to continue.");
      limit?.(req, url.pathname);
      await route(req, res, url.pathname);
    })().catch((error: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      if (error instanceof ShareError) {
        if (error instanceof GuestRateLimitError) {
          res.setHeader("Retry-After", error.retryAfter);
          req.resume();
        }
        json(res, error.status, { error: error.code, message: error.message });
      } else {
        process.stderr.write(
          "CodeShare could not complete a request. Check the service and its database.\n",
        );
        json(res, 500, {
          error: "host_error",
          message: "The host could not complete this request.",
        });
      }
    });
  });
  server.maxConnections = 128;
  return server;
}

function ownerRoutes(options: CodeShareHttpOptions): Route {
  const { service, ownerToken } = options;
  const groups: CodeShareOwnerProviderGroup[] = [
    ...listCodeShareSubscriptionProviders().map(({ id, ownerLabel, supportsOwnerChat }) => ({
      id,
      label: ownerLabel,
      showInEmptyMenu: supportsOwnerChat === true,
      emptyMessage: "Sign in on the owner computer, then refresh sign-ins",
    })),
    ...listCodeShareHostedProviders().map(({ id, ownerLabel, showInEmptyOwnerMenu }) => ({
      id,
      label: ownerLabel,
      showInEmptyMenu: showInEmptyOwnerMenu === true,
      emptyMessage: "API key needed on the host",
    })),
  ];
  const script = `(${ownerBrowser.toString()})(${JSON.stringify(groups)}, ${setupBrowser.toString()});`;
  return async (req, res, path) => {
    if (staticPage(req, res, path, ownerPage, script)) return;
    if (!matchOwner(req.headers.authorization, ownerToken))
      throw new ShareError(401, "owner_login", "Open the owner link printed by CodeShare.");
    if (req.method === "GET" && path === "/api/v1/owner")
      return json(res, 200, service.ownerState());
    if (req.method === "GET" && path === "/api/v1/owner/setup") {
      if (!options.setup)
        throw new ShareError(409, "setup_unavailable", "Owner setup is unavailable on this host.");
      return json(res, 200, await options.setup.snapshot());
    }
    if (req.method !== "POST") notFound();
    if (path.startsWith("/api/v1/owner/setup/")) {
      const setup = options.setup;
      if (!setup)
        throw new ShareError(409, "setup_unavailable", "Owner setup is unavailable on this host.");
      if (path === "/api/v1/owner/setup/keys")
        await setup.saveKey(await body(req, shareApiKeySchema, 32 * 1024));
      else if (path === "/api/v1/owner/setup/login") {
        const input = await body(
          req,
          z.strictObject({ provider: z.string().min(1).max(32), cancel: z.boolean().optional() }),
        );
        await setup.login(input.provider, input.cancel === true);
      } else if (path === "/api/v1/owner/setup/cloudflare/login") {
        await body(req, z.strictObject({}));
        await setup.cloudflare.connect();
      } else if (path === "/api/v1/owner/setup/cloudflare/login/cancel") {
        await body(req, z.strictObject({}));
        await setup.cloudflare.cancelLogin();
      } else if (path === "/api/v1/owner/setup/cloudflare/publish") {
        const { hostname } = await body(req, z.strictObject({ hostname: shareHostnameSchema }));
        await setup.cloudflare.publish(hostname);
      } else if (path === "/api/v1/owner/setup/cloudflare/existing") {
        const { hostname } = await body(req, z.strictObject({ hostname: shareHostnameSchema }));
        await setup.cloudflare.useExisting(hostname);
      } else if (path === "/api/v1/owner/setup/cloudflare/check") {
        await body(req, z.strictObject({}));
        await setup.cloudflare.check();
      } else if (path === "/api/v1/owner/setup/cloudflare/stop") {
        await body(req, z.strictObject({}));
        await setup.cloudflare.disable();
      } else notFound();
      return json(res, 200, await setup.snapshot());
    }
    if (path === "/api/v1/owner/models") {
      const { models } = await body(
        req,
        z.strictObject({ models: z.array(modelIdSchema).max(512) }),
      );
      service.setEnabledModels(models);
      return json(res, 200, { ok: true });
    }
    if (path === "/api/v1/owner/models/refresh") {
      await body(req, z.strictObject({}));
      await service.refreshModels();
      return json(res, 200, { ok: true });
    }
    if (path === "/api/v1/owner/rooms") {
      const { label } = await body(req, roomCreateSchema);
      return json(res, 201, service.createRoom(label));
    }
    if (path === "/api/v1/owner/invites") {
      const input = await body(req, createInviteSchema);
      return json(res, 201, service.createInvite(input));
    }
    if (path === "/api/v1/owner/pause") {
      const { paused } = await body(req, pauseBody);
      service.setPaused(paused);
      return json(res, 200, { ok: true });
    }
    const action = /^\/api\/v1\/owner\/invites\/([a-f0-9-]{36})\/(extend|revoke)$/u.exec(path);
    if (!action) notFound();
    const [, id, operation] = action;
    if (operation === "extend") {
      const { minutes } = await body(req, extendBody);
      service.extend(id!, minutes);
    } else {
      await body(req, z.strictObject({}));
      service.revoke(id!);
    }
    json(res, 200, { ok: true });
  };
}

function guestRoutes(options: CodeShareHttpOptions): Route {
  const { service } = options;
  const script = `(${guestBrowser.toString()})(${roomBrowser.toString()});`;
  const cookieLifetime = 400 * 24 * 60 * 60;
  return async (req, res, path) => {
    if (req.method === "GET" && path === "/.well-known/codeshare-health" && options.healthNonce)
      return json(res, 200, { nonce: options.healthNonce });
    const secure = new URL(options.guestOrigin).protocol === "https:";
    const cookie = secure ? "__Host-codeshare_guest" : "codeshare_guest";
    const claimCookie = secure ? "__Host-codeshare_claim" : "codeshare_claim";
    const claim = readCookie(req, claimCookie);
    if (req.method === "GET" && path === "/" && !claim)
      setCookie(res, claimCookie, shareSecret(), secure, cookieLifetime);
    if (staticPage(req, res, path, guestPage, script)) return;
    const session = readCookie(req, cookie);
    if (req.method === "POST" && path === "/api/v1/redeem") {
      const { code } = await body(req, codeBody);
      if (!claim) {
        setCookie(res, claimCookie, shareSecret(), secure, cookieLifetime);
        throw new ShareError(
          409,
          "redemption_setup",
          "Your browser is ready. Try the invite code again.",
        );
      }
      try {
        const supportsRooms =
          new URL(req.url ?? "/", options.guestOrigin).searchParams.get("rooms") === "2";
        const redeemed = service.redeem(code, claim, session, true, supportsRooms);
        setCookie(res, cookie, redeemed, secure, cookieLifetime);
        setCookie(res, claimCookie, shareSecret(), secure, cookieLifetime);
        return json(res, 200, service.guestState(redeemed));
      } catch (error) {
        if (error instanceof ShareError && error.code === "redemption_conflict")
          setCookie(res, claimCookie, shareSecret(), secure, cookieLifetime);
        throw error;
      }
    }
    if (!path.startsWith("/api/v1/")) notFound();
    return guestSessionRoute(service, session, req, res, path.slice("/api/v1".length));
  };
}

function appGuestRoutes(options: CodeShareHttpOptions): Route {
  const { service } = options;
  const claims = createAppClaims();
  return async (req, res, path) => {
    if (req.method === "POST" && path === "/claim") {
      await body(req, z.strictObject({}));
      return json(res, 200, { claim: claims.issue() });
    }
    if (req.method === "POST" && path === "/redeem") {
      const { code, claim } = await body(req, appRedeemSchema);
      const parameters = new URL(req.url ?? "/", options.guestOrigin).searchParams;
      const desktop = parameters.get("desktop") === "1";
      const token = claims.verify(claim);
      service.redeem(code, token, "", !desktop, desktop && parameters.get("room") === "2");
      return json(res, 200, { token, state: service.guestState(token) });
    }
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (path === "/room" || path.startsWith("/room/"))
      return roomRoutes(service, token, req, res, path);
    if (req.method === "POST" && path === "/local-launch") {
      const input = await body(req, reserveLocalLaunchSchema);
      service.reserveLocalLaunch(token, input);
      return json(res, 200, { ok: true });
    }
    return guestSessionRoute(service, token, req, res, path);
  };
}

async function roomRoutes(
  service: CodeShareService,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const member = service.roomMember(token);
  const room = service.rooms;
  if (req.method === "GET" && path === "/room") {
    const parameters = new URL(req.url ?? "/", "http://localhost").searchParams;
    if (parameters.get("roomProtocol") !== String(CODE_SHARE_ROOM_PROTOCOL))
      throw new ShareError(409, "room_update_required", "Update CodeShare to join this room.");
    const raw = parameters.get("revision");
    const cursor = z
      .uuid()
      .optional()
      .parse(parameters.get("memberCursor") ?? undefined);
    const revision = raw !== null && /^\d{1,15}$/u.test(raw) ? Number(raw) : undefined;
    return json(res, 200, room.snapshot(member, revision, service.paused, cursor));
  }
  if (req.method !== "POST") notFound();
  switch (path) {
    case "/room/ready": {
      const { ready } = await body(req, roomReadySchema);
      room.setReady(member, ready);
      break;
    }
    case "/room/turns":
      room.submit(member, await body(req, submitRoomTurnSchema), service.paused);
      break;
    case "/room/claim": {
      const { id, lease } = await body(req, roomClaimSchema);
      return json(res, 200, room.claim(member, id, lease, service.paused));
    }
    case "/room/lease": {
      const { id, lease, reply } = await body(req, roomProgressSchema, 320 * 1024);
      return json(res, 200, { status: room.leaseStatus(member, id, lease, service.paused, reply) });
    }
    case "/room/finish": {
      const { id, lease, outcome, reply } = await body(req, roomFinishSchema, 320 * 1024);
      room.finish(member, id, lease, outcome, reply, service.paused);
      break;
    }
    case "/room/files": {
      const { id, lease } = await body(req, roomClaimSchema);
      return json(res, 200, room.fileRequests(member, id, lease, service.paused));
    }
    case "/room/file-result": {
      const { id, lease, requestId, result } = await body(req, shareFileReplySchema, 1024 * 1024);
      room.fileResult(member, id, lease, requestId, result, service.paused);
      break;
    }
    case "/room/stop": {
      const { id } = await body(
        req,
        stopTurnSchema.extend({ protocolVersion: z.literal(CODE_SHARE_ROOM_PROTOCOL) }),
      );
      room.stop(member, id, service.paused);
      break;
    }
    default:
      notFound();
  }
  json(res, 200, { ok: true });
}

async function guestSessionRoute(
  service: CodeShareService,
  session: string,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  if (path === "/room" || path.startsWith("/room/"))
    return roomRoutes(service, session, req, res, path);
  if (req.method === "GET" && path === "/session")
    return json(res, 200, service.guestState(session));
  if (req.method === "POST" && path === "/turns") {
    const input = await body(req, submitTurnSchema);
    return json(res, 202, service.submit(session, input));
  }
  if (req.method === "POST" && path === "/stop") {
    const { id } = await body(req, stopTurnSchema);
    service.stop(session, id);
    return json(res, 200, { ok: true });
  }
  notFound();
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function stop(server: Server): Promise<void> {
  return new Promise((resolve) => {
    // Stop admission before destroying connections so none can slip in.
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function startCodeShareHttp(options: CodeShareHttpOptions): Promise<{
  ownerOrigin: string;
  guestPort: number;
  close: () => Promise<void>;
}> {
  let ownerOrigin = `http://127.0.0.1:${options.adminPort}`;
  const owner = createListener(
    () => ownerOrigin,
    ownerRoutes(options),
    undefined,
    (req, res, path) => options.service.fileTools.handle(req, res, path),
  );
  const guest = createListener(() => options.guestOrigin, guestRoutes(options), {
    appRoutes: appGuestRoutes(options),
    trustCloudflareClientIp: () =>
      options.trustCloudflareClientIp === true &&
      new URL(options.guestOrigin).protocol === "https:",
  });
  try {
    const ownerPort = await listen(owner, options.adminPort);
    ownerOrigin = `http://127.0.0.1:${ownerPort}`;
    options.service.fileTools.setOrigin(ownerOrigin);
    const guestPort = await listen(guest, options.guestPort);
    return {
      ownerOrigin,
      guestPort,
      close: async () => {
        await Promise.all([stop(guest), stop(owner)]);
      },
    };
  } catch (error) {
    await Promise.all([stop(owner), stop(guest)]);
    throw error;
  }
}
