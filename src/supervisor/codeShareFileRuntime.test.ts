import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, symlink, stat, link } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ProjectTreeService } from "./projectTree";
import { CodeShareFileRuntime } from "./codeShareFileRuntime";

it("scopes file access, rejects private/ignored/link paths, preserves concurrent edits and replays a write only once", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-files-"));
  const projectLocation = { kind: "posix" as const, path: root };
  const runtime = new CodeShareFileRuntime(
    new ProjectTreeService(),
    async (_location, path) => path === "ignored.txt",
  );
  try {
    await writeFile(join(root, "a.txt"), "before");
    await writeFile(join(root, ".env"), "private");
    await symlink(join(root, ".env"), join(root, "alias"));
    await link(join(root, ".env"), join(root, "hardlink"));
    const grant = { projectLocation, ...(await runtime.open({ projectLocation })) };
    const run = (tool: unknown, requestId = randomUUID()) =>
      runtime.execute({ ...grant, requestId, tool });
    expect(await run({ name: "read_file", path: "a.txt" })).toMatchObject({
      ok: true,
      value: { content: "before" },
    });
    for (const path of [".env", ".ENV", ".GiT/config", "ignored.txt", "alias", "hardlink"])
      expect(await run({ name: "read_file", path })).toMatchObject({ ok: false });
    expect(() => run({ name: "read_file", path: "../escape" })).toThrow(
      "Use a project-relative file path",
    );
    const expectedModifiedAtMs = (await stat(join(root, "a.txt"))).mtimeMs;
    const requestId = randomUUID();
    const tool = { name: "write_file", path: "a.txt", content: "after", expectedModifiedAtMs };
    const first = await run(tool, requestId);
    expect(first).toMatchObject({ ok: true });
    await writeFile(join(root, "a.txt"), "local edit");
    expect(await run(tool, requestId)).toEqual(first);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("local edit");
    expect(await run({ ...tool, content: "different" }, requestId)).toMatchObject({ ok: false });
    expect(await run(tool)).toMatchObject({ ok: false });
    expect(await run({ name: "create_file", path: ".gitignore", content: "" })).toMatchObject({
      ok: false,
    });
    await runtime.end(grant);
    expect(await run({ name: "read_file", path: "a.txt" })).toMatchObject({ ok: false });
    expect(await runtime.end({ ...grant, incarnation: randomUUID() })).toEqual({ closed: true });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("closes a grant only after accepted operations finish and rejects further work while draining", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-drain-"));
  const block = Promise.withResolvers<boolean>();
  const runtime = new CodeShareFileRuntime(new ProjectTreeService(), () => block.promise);
  const projectLocation = { kind: "posix" as const, path: root };
  try {
    await writeFile(join(root, "a.txt"), "a");
    const grant = { projectLocation, ...(await runtime.open({ projectLocation })) };
    const pending = runtime.execute({
      ...grant,
      requestId: randomUUID(),
      tool: { name: "read_file", path: "a.txt" },
    });
    let closed = false;
    const closing = runtime.end(grant).then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(
      await runtime.execute({
        ...grant,
        requestId: randomUUID(),
        tool: { name: "read_file", path: "a.txt" },
      }),
    ).toMatchObject({ ok: false });
    block.resolve(false);
    expect(await pending).toMatchObject({ ok: true });
    await closing;
    expect(closed).toBe(true);
  } finally {
    block.resolve(false);
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses Win32 device, short-name and trimmed aliases before filesystem access", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-win-paths-"));
  const projectLocation = { kind: "windows" as const, path: root };
  const runtime = new CodeShareFileRuntime(new ProjectTreeService(), async () => false);
  try {
    const grant = { projectLocation, ...(await runtime.open({ projectLocation })) };
    for (const path of [
      "CON",
      "nul.txt",
      "src/COM¹.log",
      "lPt9.txt",
      "NODE_M~1/file",
      "file. ",
      ".git /config",
      ".ENV",
      "bad?name",
    ])
      expect(
        await runtime.execute({
          ...grant,
          requestId: randomUUID(),
          tool: { name: "read_file", path },
        }),
      ).toMatchObject({ ok: false });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("requires a project scope instead of a home directory or its ancestor", async () => {
  const runtime = new CodeShareFileRuntime(new ProjectTreeService());
  try {
    await expect(
      runtime.open({ projectLocation: { kind: "posix", path: homedir() } }),
    ).rejects.toThrow("Choose a project folder");
  } finally {
    await runtime.close();
  }
});
