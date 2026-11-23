import { z } from "zod";

export const MAX_PROMPT_CHARS = 16_000;
export const MAX_REPLY_CHARS = 48_000;
export const MAX_OUTPUT_TOKENS = 4_096;
export const MAX_DURATION_MINUTES = 60 * 24 * 30;
export const MAX_INVITE_MINUTES = 60 * 24 * 7;

export const modelIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u);

export interface ShareModel {
  id: string;
  provider: string;
  model: string;
  execution?: "guest-subscription";
}

export function parseModel(id: string): ShareModel {
  modelIdSchema.parse(id);
  const delimiter = id.indexOf(":");
  return { id, provider: id.slice(0, delimiter), model: id.slice(delimiter + 1) };
}

export const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{22}$/u);
export const createInviteSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().min(1).max(MAX_DURATION_MINUTES),
  redeemWithinMinutes: z.number().int().min(1).max(MAX_INVITE_MINUTES),
  turnLimit: z.number().int().min(1).max(500),
  models: z.array(modelIdSchema).min(1).max(64),
});

export const submitTurnSchema = z.strictObject({
  id: z.uuid(),
  model: modelIdSchema,
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
});

export const reserveLocalLaunchSchema = submitTurnSchema.pick({ id: true, model: true });
export type ReserveLocalLaunch = z.infer<typeof reserveLocalLaunchSchema>;

export type CreateInvite = z.infer<typeof createInviteSchema>;
export type SubmitTurn = z.infer<typeof submitTurnSchema>;
export type InviteStatus = "pending" | "active" | "paused" | "expired" | "revoked";
export type TurnStatus = "running" | "complete" | "interrupted" | "failed";
export type TurnIssue =
  | "expired"
  | "revoked"
  | "paused"
  | "stopped"
  | "restarted"
  | "provider_unavailable"
  | "provider_access"
  | "provider_limited"
  | "model_unavailable"
  | "model_mismatch"
  | "request_rejected"
  | "response_limit";

export interface ChatTurn {
  seq: number;
  id: string;
  model: string;
  prompt: string;
  reply: string;
  status: TurnStatus;
  issue: TurnIssue | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface InviteView {
  id: string;
  label: string;
  models: string[];
  durationMinutes: number;
  redeemBy: number;
  expiresAt: number | null;
  turnLimit: number;
  turnsUsed: number;
  inputTokens: number;
  outputTokens: number;
  status: InviteStatus;
}

export interface OwnerState {
  paused: boolean;
  guestOrigin: string;
  models: ShareModel[];
  invites: InviteView[];
  serverNow: number;
}

export interface GuestState {
  serverNow: number;
  expiresAt: number;
  status: InviteStatus;
  turnsRemaining: number;
  models: ShareModel[];
  turns: ChatTurn[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class ShareError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The additive app API uses bearer auth. Browser cookies remain guest-site only. */
export const CODE_SHARE_APP_PATH = "/api/v1/app";
export const shareSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const appRedeemSchema = z.strictObject({
  code: codeSchema,
  claim: z.string().regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u),
});
export const stopTurnSchema = z.strictObject({ id: z.uuid() });

const chatTurnSchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  model: modelIdSchema,
  prompt: z.string().max(MAX_PROMPT_CHARS),
  reply: z.string().max(MAX_REPLY_CHARS),
  status: z.enum(["running", "complete", "interrupted", "failed"]),
  issue: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
});

export const guestSnapshotSchema = z.object({
  serverNow: z.number().int(),
  expiresAt: z.number().int(),
  status: z.enum(["pending", "active", "paused", "expired", "revoked"]),
  turnsRemaining: z.number().int().nonnegative(),
  models: z
    .array(
      z.object({
        id: modelIdSchema,
        provider: z.string(),
        model: z.string(),
        execution: z.literal("guest-subscription").optional(),
      }),
    )
    .max(64),
  turns: z.array(chatTurnSchema).max(12),
});

export const appClaimResponseSchema = z.object({ claim: appRedeemSchema.shape.claim });
export const appRedeemResponseSchema = z.object({
  token: shareSecretSchema,
  state: guestSnapshotSchema,
});
