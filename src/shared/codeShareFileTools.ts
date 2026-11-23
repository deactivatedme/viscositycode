import { z } from "zod";
import { projectLocationSchema } from "./contracts/common";

export const CODE_SHARE_ROOM_PROTOCOL = 2;
export const CODE_SHARE_REMOTE_TURN_TIMEOUT_MS = 10 * 60_000;
export const CODE_SHARE_WORKSPACE_MCP = "codeshare_workspace";
export const MAX_SHARE_FILE_CHARS = 128_000;
const path = z
  .string()
  .min(1)
  .max(1024)
  .regex(
    /^(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/\\:\p{Cc}]+(?:\/[^/\\:\p{Cc}]+)*$/u,
    "Use a project-relative file path",
  );
export const shareFileToolSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("find_files"), query: z.string().max(256) }),
  z.strictObject({ name: z.literal("read_file"), path }),
  z.strictObject({
    name: z.literal("write_file"),
    path,
    content: z.string().max(MAX_SHARE_FILE_CHARS),
    expectedModifiedAtMs: z.number().nonnegative(),
  }),
  z.strictObject({
    name: z.literal("create_file"),
    path,
    content: z.string().max(MAX_SHARE_FILE_CHARS),
  }),
]);
export type ShareFileTool = z.infer<typeof shareFileToolSchema>;
export const shareFileRequestSchema = z.object({ id: z.uuid(), tool: shareFileToolSchema });
export const shareFileResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string().max(1000) }),
]);
export type ShareFileResult = z.infer<typeof shareFileResultSchema>;
export const shareFileBridgeSchema = z.object({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.pathname.startsWith("/api/v1/runtime-tools/") &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search
    );
  }),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});
export type ShareFileBridge = z.infer<typeof shareFileBridgeSchema>;
export const shareFileScopeSchema = z.strictObject({ projectLocation: projectLocationSchema });
export const shareFileGrantSchema = z.strictObject({
  projectLocation: projectLocationSchema,
  grantId: z.uuid(),
  incarnation: z.uuid(),
});
export const shareFileExecuteSchema = shareFileGrantSchema.extend({
  requestId: z.uuid(),
  tool: shareFileToolSchema,
});
export const shareFileGrantResultSchema = z.object({ grantId: z.uuid(), incarnation: z.uuid() });
export const shareFileClosedSchema = z.object({ closed: z.literal(true) });
export const shareFilePollSchema = z.object({
  status: z.enum(["running", "stopping", "complete", "failed"]),
  requests: z.array(shareFileRequestSchema).max(32),
  providerDone: z.boolean(),
});
export const shareFileReplySchema = z.strictObject({
  id: z.uuid(),
  lease: z.uuid(),
  requestId: z.uuid(),
  result: shareFileResultSchema,
  protocolVersion: z.literal(CODE_SHARE_ROOM_PROTOCOL),
});
