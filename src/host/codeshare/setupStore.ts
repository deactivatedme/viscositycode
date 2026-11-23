import { readFile, lstat } from "node:fs/promises";
import { z } from "zod";
import { encryptSecret, decryptSecret, isEncryptedSecret } from "@/shared/secretStorage";
import { writeFileAtomicAsync } from "@/shared/atomicFileAsync";
import { modelIdSchema } from "@/shared/codeShare";
import { shareHostnameSchema } from "@/shared/codeShareSetup";

// Independent v1 encrypted setup document. The grants/chat database is independently versioned.
// Missing prior files mean environment-only setup; unknown versions are never overwritten.
const setupSchema = z.strictObject({
  version: z.literal(1),
  keys: z.record(z.string(), z.string().nullable()),
  models: z.record(z.string(), z.array(modelIdSchema).max(64)),
  externalHostname: shareHostnameSchema.optional(),
  cloudflare: z
    .strictObject({
      hostname: shareHostnameSchema,
      tunnelId: z.uuid(),
      enabled: z.boolean().default(true),
      phase: z.enum(["created", "routed"]).default("created"),
    })
    .optional(),
});
export type ShareSetupData = z.infer<typeof setupSchema>;

export class CodeShareSetupStore {
  private current: ShareSetupData = { version: 1, keys: {}, models: {} };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    this.loaded = false;
    let raw: string;
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024)
        throw new Error("Invalid CodeShare setup file.");
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.loaded = true;
        return;
      }
      throw error;
    }
    if (!isEncryptedSecret(raw)) throw new Error("The CodeShare setup file is not encrypted.");
    this.current = setupSchema.parse(JSON.parse(decryptSecret("", raw)));
    this.loaded = true;
  }
  read(): ShareSetupData {
    return structuredClone(this.current);
  }
  update(change: (current: ShareSetupData) => ShareSetupData): Promise<void> {
    const next = this.writing.then(async () => {
      if (!this.loaded)
        throw new Error("CodeShare setup could not be loaded; existing bytes were preserved.");
      const value = setupSchema.parse(change(this.read()));
      await writeFileAtomicAsync(this.path, encryptSecret("", JSON.stringify(value)), {
        mode: 0o600,
      });
      this.current = value;
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}
