import { CODE_SHARE_ROOM_PROTOCOL } from "./codeShareFileTools";
import { z } from "zod";

export const roomLabelSchema = z.string().trim().min(1).max(80);
export const roomIdSchema = z.uuid();
export const roomRunnerSchema = z.union([z.literal("host"), z.uuid()]);
export const roomCreateSchema = z.strictObject({ label: roomLabelSchema });
export const roomRefSchema = z.object({ id: roomIdSchema, label: roomLabelSchema });
export const roomTurnStatusSchema = z.enum([
  "queued",
  "running",
  "stopping",
  "complete",
  "failed",
  "cancelled",
]);
export const roomTurnSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid(),
  authorName: z.string(),
  runner: roomRunnerSchema,
  runnerName: z.string(),
  model: z.string(),
  prompt: z.string(),
  reply: z.string(),
  status: roomTurnStatusSchema,
  execution: z.enum(["participant", "owner"]).optional(),
});
export const roomSnapshotSchema = z.object({
  protocolVersion: z.literal(CODE_SHARE_ROOM_PROTOCOL),
  nextMemberCursor: z.string().optional(),
  revision: z.number().int(),
  memberId: z.uuid(),
  active: z.boolean(),
  members: z
    .array(
      z.object({
        id: z.uuid(),
        label: z.string(),
        ready: z.boolean(),
        models: z.array(z.string()).max(64),
      }),
    )
    .max(100),
  turns: z.array(roomTurnSchema).max(40).optional(),
});
export const roomRunReceiptSchema = z.object({
  id: z.uuid(),
  model: z.string(),
  prompt: z.string().max(16_000),
  execution: z.enum(["participant", "owner"]).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(48_000),
      }),
    )
    .max(80),
});
export const roomClaimSchema = z.strictObject({
  id: z.uuid(),
  lease: z.uuid(),
  protocolVersion: z.literal(CODE_SHARE_ROOM_PROTOCOL),
});
export const roomProgressSchema = roomClaimSchema.extend({
  reply: z.string().max(48_000).optional(),
});
export const roomFinishSchema = roomClaimSchema.extend({
  reply: z.string().max(48_000),
  outcome: z.enum(["complete", "failed", "cancelled"]),
});
export const roomReadySchema = z.strictObject({
  ready: z.boolean(),
  protocolVersion: z.literal(CODE_SHARE_ROOM_PROTOCOL),
});
export type ShareRoomRef = z.output<typeof roomRefSchema>;
export type ShareRoomSnapshot = z.output<typeof roomSnapshotSchema>;
export type ShareRoomTurn = z.output<typeof roomTurnSchema>;
export type RoomRunReceipt = z.output<typeof roomRunReceiptSchema>;
export type RoomClaim = Omit<z.input<typeof roomClaimSchema>, "protocolVersion">;
export type RoomFinish = Omit<z.input<typeof roomFinishSchema>, "protocolVersion">;
