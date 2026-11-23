import { z } from "zod";
import { modelIdSchema } from "./codeShare";

export interface ShareConnection {
  id: string;
  label: string;
  connected: boolean;
  state: "idle" | "waiting" | "connected" | "failed";
  url?: string;
  message?: string;
}
export interface ShareApiConnection {
  id: string;
  label: string;
  configured: boolean;
  discoverModels: boolean;
  importAccount?: true;
  models: string[];
}
export interface CodeShareSetupSnapshot {
  subscriptions: ShareConnection[];
  apiKeys: ShareApiConnection[];
  cloudflare: ShareConnection & {
    hostname?: string;
    tunnelId?: string;
    running: boolean;
    verified: boolean;
    publishing: boolean;
    external?: boolean;
  };
}
export const shareApiKeySchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("import"),
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
  }),
  z.strictObject({
    action: z.literal("save"),
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
    key: z
      .string()
      .trim()
      .min(1)
      .max(16_000)
      .regex(/^[^\r\n]+$/u),
    models: z.array(modelIdSchema).max(64),
  }),
  z.strictObject({
    action: z.literal("remove"),
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
  }),
]);
export const shareHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/u);
