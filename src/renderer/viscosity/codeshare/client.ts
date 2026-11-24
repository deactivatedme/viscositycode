import {
  CODE_SHARE_ROOM_PROTOCOL,
  shareFilePollSchema,
  type ShareFileResult,
} from "@/shared/codeShareFileTools";
import { z } from "zod";
import {
  appClaimResponseSchema,
  appRedeemResponseSchema,
  CODE_SHARE_APP_PATH,
  codeSchema,
  guestSnapshotSchema,
  shareSecretSchema,
  type SubmitTurn,
  type ReserveLocalLaunch,
  type submitRoomTurnSchema,
} from "@/shared/codeShare";
import {
  roomRunReceiptSchema,
  roomSnapshotSchema,
  roomTurnStatusSchema,
  type RoomClaim,
  type RoomFinish,
} from "@/shared/codeShareRoom";
import { readBoundedResponseBody } from "@/shared/remote/responseBody";
import {
  deleteDesktopToken,
  getDesktopToken,
  setDesktopToken,
} from "@/renderer/state/remoteServers/tokenVault";

export type Snapshot = z.output<typeof guestSnapshotSchema>;

const connectionSchema = z.strictObject({
  version: z.literal(1),
  origin: z.string(),
  token: shareSecretSchema,
  projectChats: z.literal(true).optional(),
});
const okResponse = z.object({ ok: z.literal(true) });
const errorResponse = z.object({ error: z.string() });
const VAULT_SLOT = "viscosity-codeshare-v1";
type Connection = z.output<typeof connectionSchema>;

export class CodeShareClientError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function allowedOrigin(url: URL): boolean {
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1"))
  );
}

export function parseShareInvite(value: string): { origin: string; code: string } {
  try {
    const input = value.trim();
    const portable = /^CS1\.([A-Za-z0-9+/=]{1,684})\.([A-Za-z0-9_-]{22})$/u.exec(input);
    const url = new URL(portable ? atob(portable[1]!) + "/#invite=" + portable[2] : input);
    const code = codeSchema.safeParse(new URLSearchParams(url.hash.slice(1)).get("invite"));
    if (
      allowedOrigin(url) &&
      url.pathname === "/" &&
      !url.search &&
      code.success &&
      (!portable || url.origin === atob(portable[1]!))
    )
      return { origin: url.origin, code: code.data };
  } catch {
    // The UI translates one error for malformed and incomplete links.
  }
  throw new CodeShareClientError("invalid_link");
}

async function request<T>(
  origin: string,
  path: string,
  schema: z.ZodType<T>,
  options: { token?: string; data?: object; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  let response: Response;
  try {
    response = await fetch(origin + CODE_SHARE_APP_PATH + path, {
      method: options.data === undefined ? "GET" : "POST",
      headers: {
        ...(options.data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.data !== undefined ? { body: JSON.stringify(options.data) } : {}),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
    });
  } catch {
    throw new CodeShareClientError("offline");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(await readBoundedResponseBody(response, 5 * 1024 * 1024)),
    );
  } catch {
    throw new CodeShareClientError(response.status === 404 ? "old_host" : "invalid_response");
  }
  if (!response.ok) {
    const error = errorResponse.safeParse(payload);
    // An earlier host returns its generic not_found response for app routes.
    const code = error.success ? error.data.error : "invalid_response";
    throw new CodeShareClientError(code === "not_found" ? "old_host" : code);
  }
  const result = schema.safeParse(payload);
  if (!result.success) throw new CodeShareClientError("invalid_response");
  return result.data;
}

export class CodeShareConnection {
  constructor(private readonly connection: Connection) {}

  static async restore(): Promise<CodeShareConnection | null> {
    const raw = await getDesktopToken(VAULT_SLOT);
    if (!raw) return null;
    try {
      const connection = connectionSchema.parse(JSON.parse(raw));
      const origin = new URL(connection.origin);
      if (allowedOrigin(origin) && origin.origin === connection.origin)
        return new CodeShareConnection(connection);
    } catch {
      // A future or malformed record is preserved until an explicit join or leave.
    }
    return null;
  }

  static async clearSaved(): Promise<void> {
    await deleteDesktopToken(VAULT_SLOT);
  }

  static async join(
    invite: ReturnType<typeof parseShareInvite>,
    attempt: { claim?: string },
    desktop = false,
    retry = true,
  ): Promise<{ client: CodeShareConnection; state: Snapshot }> {
    const { origin, code } = invite;
    if (!attempt.claim) {
      const { claim } = await request(origin, "/claim", appClaimResponseSchema, { data: {} });
      attempt.claim = claim;
    }
    try {
      const { token, state } = await request(
        origin,
        desktop ? "/redeem?desktop=1&room=2&project=1" : "/redeem",
        appRedeemResponseSchema,
        {
          data: { code, claim: attempt.claim },
        },
      );
      return { client: new CodeShareConnection({ version: 1, origin, token }), state };
    } catch (error) {
      if (!retry || !(error instanceof CodeShareClientError) || error.code !== "claim_expired")
        throw error;
      // The host restarted. A previously redeemed bearer survives independently
      // of its admission signature, so recover it before issuing a fresh claim.
      const token = shareSecretSchema.parse(attempt.claim.split(".")[0]);
      const client = new CodeShareConnection({ version: 1, origin, token });
      try {
        return { client, state: await client.snapshot() };
      } catch (recoveryError) {
        if (
          !(recoveryError instanceof CodeShareClientError) ||
          recoveryError.code !== "guest_session"
        )
          throw recoveryError;
        delete attempt.claim;
      }
      return CodeShareConnection.join(invite, attempt, desktop, false);
    }
  }

  save(): Promise<boolean> {
    return setDesktopToken(VAULT_SLOT, JSON.stringify(this.connection));
  }

  get projectChats(): boolean {
    return this.connection.projectChats === true;
  }

  markProjectChats(): void {
    this.connection.projectChats = true;
  }

  projectAccess(): { origin: string; token: string } {
    return { origin: this.connection.origin, token: this.connection.token };
  }

  snapshot(signal?: AbortSignal): Promise<Snapshot> {
    return request(this.connection.origin, "/session", guestSnapshotSchema, {
      token: this.connection.token,
      ...(signal ? { signal } : {}),
    });
  }

  async roomSnapshot(revision: number | undefined, signal?: AbortSignal) {
    const page = (cursor?: string) =>
      request(
        this.connection.origin,
        "/room?roomProtocol=2" +
          (revision === undefined ? "" : "&revision=" + revision) +
          (cursor ? "&memberCursor=" + cursor : ""),
        roomSnapshotSchema,
        { token: this.connection.token, ...(signal ? { signal } : {}) },
      );
    const snapshot = await page();
    const cursors = new Set<string>();
    let cursor = snapshot.nextMemberCursor;
    while (cursor) {
      if (cursors.has(cursor)) throw new CodeShareClientError("invalid_response");
      cursors.add(cursor);
      const next = await page(cursor);
      snapshot.members.push(...next.members);
      cursor = next.nextMemberCursor;
    }
    delete snapshot.nextMemberCursor;
    return snapshot;
  }

  roomFileRequests(input: RoomClaim) {
    return request(this.connection.origin, "/room/files", shareFilePollSchema, {
      token: this.connection.token,
      data: { ...input, protocolVersion: CODE_SHARE_ROOM_PROTOCOL },
    });
  }
  async roomFileResult(input: RoomClaim, requestId: string, result: ShareFileResult) {
    await this.postRoom("file-result", { ...input, requestId, result });
  }

  async setRoomReady(ready: boolean): Promise<void> {
    await this.postRoom("ready", { ready });
  }

  async sendRoomTurn(
    turn: Omit<z.input<typeof submitRoomTurnSchema>, "protocolVersion">,
  ): Promise<void> {
    await this.postRoom("turns", turn);
  }

  claimRoomTurn(input: RoomClaim) {
    return request(this.connection.origin, "/room/claim", roomRunReceiptSchema, {
      token: this.connection.token,
      data: { ...input, protocolVersion: CODE_SHARE_ROOM_PROTOCOL },
    });
  }

  async roomLeaseStatus(input: RoomClaim, reply?: string) {
    const response = await request(
      this.connection.origin,
      "/room/lease",
      z.object({ status: roomTurnStatusSchema }),
      {
        token: this.connection.token,
        data: {
          ...input,
          protocolVersion: CODE_SHARE_ROOM_PROTOCOL,
          ...(reply !== undefined ? { reply } : {}),
        },
      },
    );
    return response.status;
  }

  async endRoomTurn(input: RoomFinish): Promise<void> {
    await this.postRoom("finish", input);
  }

  async stopRoomTurn(id: string): Promise<void> {
    await this.postRoom("stop", { id });
  }

  private async postRoom(path: string, data: object): Promise<void> {
    await request(this.connection.origin, "/room/" + path, okResponse, {
      token: this.connection.token,
      data: { ...data, protocolVersion: CODE_SHARE_ROOM_PROTOCOL },
    });
  }

  async submit(turn: SubmitTurn): Promise<boolean> {
    const receipt = await request(
      this.connection.origin,
      "/turns",
      z.object({
        id: z.literal(turn.id),
        status: z.enum(["running", "complete", "interrupted", "failed"]),
      }),
      {
        token: this.connection.token,
        data: turn,
      },
    );
    return receipt.status === "running";
  }

  async reserveLocalLaunch(input: ReserveLocalLaunch): Promise<void> {
    await request(this.connection.origin, "/local-launch", okResponse, {
      token: this.connection.token,
      data: input,
    });
  }

  async stop(id: string): Promise<void> {
    await request(this.connection.origin, "/stop", okResponse, {
      token: this.connection.token,
      data: { id },
    });
  }
}
