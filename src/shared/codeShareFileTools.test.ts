import { expect, it } from "vitest";
import { shareFileToolSchema } from "./codeShareFileTools";

it("accepts project-relative Unicode paths and rejects path/namespace escapes before dispatch", () => {
  for (const path of ["src/index.ts", "src/中文.ts", "notes with spaces.md", ".gitignore"])
    expect(shareFileToolSchema.safeParse({ name: "read_file", path }).success).toBe(true);
  for (const path of [
    "/etc/passwd",
    "../secret",
    "src/../secret",
    "src/..",
    "./file",
    "src//file",
    "C:/secret",
    "C:secret",
    "src\\file",
    "src/\0file",
  ])
    expect(shareFileToolSchema.safeParse({ name: "read_file", path }).success).toBe(false);
});
