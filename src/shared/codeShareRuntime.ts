import { shareFileBridgeSchema } from "./codeShareFileTools";
import { z } from "zod";
import { MAX_PROMPT_CHARS, modelIdSchema } from "./codeShare";

// Host-only bridge, deliberately absent from the public IPC/remote procedure registry.
// A distinct request name makes older supervisors refuse before starting a run.
export const CODE_SHARE_RUNTIME_REQUEST = "codeshare-runtime-v1";
export const codeShareRuntimePayloadSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("catalog") }),
  z.strictObject({ action: z.literal("key-import"), id: z.uuid(), provider: z.string().max(32) }),
  z.strictObject({
    action: z.literal("key-catalog"),
    id: z.uuid(),
    provider: z.string().max(32),
    key: z.string().min(1).max(16000),
  }),
  z.strictObject({ action: z.literal("connections") }),
  z.strictObject({ action: z.literal("login-start"), provider: z.string().max(32) }),
  z.strictObject({ action: z.literal("login-cancel"), provider: z.string().max(32) }),
  z.strictObject({
    action: z.enum(["run", "key-run"]),
    key: z.string().min(1).max(16000).optional(),
    id: z.uuid(),
    model: modelIdSchema,
    remoteTools: shareFileBridgeSchema.optional(),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(Math.max(MAX_PROMPT_CHARS, 48_000)),
        }),
      )
      .min(1)
      .max(80),
  }),
  z.strictObject({ action: z.literal("cancel"), id: z.uuid() }),
]);
export type CodeShareRuntimePayload = z.infer<typeof codeShareRuntimePayloadSchema>;
export interface CodeShareRuntimeRequest {
  id: string;
  type: typeof CODE_SHARE_RUNTIME_REQUEST;
  payload: unknown;
}
export function isCodeShareRuntimeRequest(value: {
  type: string;
}): value is CodeShareRuntimeRequest {
  return value.type === CODE_SHARE_RUNTIME_REQUEST;
}
