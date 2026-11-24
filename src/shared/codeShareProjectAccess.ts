import { z } from "zod";
import { shareSecretSchema } from "./codeShare";

export { CODE_SHARE_PROJECT_AGENT } from "./agents/codeShareProject";

export const codeShareProjectAccessSchema = z.strictObject({
  origin: z
    .url()
    .max(512)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.origin === value &&
        (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1"))
      );
    }),
  token: shareSecretSchema,
});
export type CodeShareProjectAccess = z.infer<typeof codeShareProjectAccessSchema>;

export const configureCodeShareProjectsSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("connect"),
    origin: z.string().max(512),
    token: shareSecretSchema,
  }),
  z.strictObject({
    action: z.literal("disconnect"),
    origin: z.string().max(512),
    token: shareSecretSchema,
  }),
]);
export const configureCodeShareProjectsReplySchema = z.object({ connected: z.boolean() });
