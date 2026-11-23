import { randomBytes } from "node:crypto";
import { open, lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// Independent versioned headless key document; never rotate an existing key
// implicitly because doing so would orphan saved API credentials.
const schema = z.strictObject({
  version: z.literal(1),
  key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u),
});
export async function loadCodeShareSetupKey(root: string): Promise<string> {
  const path = join(root, "setup-key.json");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096)
      throw new Error("Invalid CodeShare setup key file.");
    return schema.parse(JSON.parse(await readFile(path, "utf8"))).key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let encryptedSetupExists = true;
  try {
    await lstat(join(root, "setup.enc"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    encryptedSetupExists = false;
  }
  if (encryptedSetupExists)
    throw new Error(
      "The CodeShare setup key is missing. Restore it with the encrypted setup backup; no replacement key was created.",
    );
  const key = randomBytes(32).toString("base64");
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ version: 1, key }));
    await file.sync();
  } finally {
    await file.close();
  }
  return key;
}
