import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, it } from "vitest";
import { parseModel } from "@/shared/codeShare";
import { CodeShareFileRuntime } from "@/supervisor/codeShareFileRuntime";
import { ProjectTreeService } from "@/supervisor/projectTree";
import { CodeShareService } from "./service";
import { CodeShareStore, shareSecret } from "./store";

it("runs owner-funded MCP file edits on the approved participant and fences the queue until local drain", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-room-files-"));
  const model = {
    ...parseModel("claude:fixture"),
    execution: "owner-subscription" as const,
    remoteEditing: true as const,
  };
  const local = new CodeShareFileRuntime(new ProjectTreeService(), async () => false);
  let providerError: unknown;
  const service = new CodeShareService(
    new CodeShareStore(join(root, "share.sqlite")),
    "https://example.test",
    [model],
    async ({ remoteTools, append }) => {
      expect(remoteTools).toBeDefined();
      const client = new Client({ name: "file-fixture", version: "1" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(remoteTools!.url), {
            requestInit: { headers: { Authorization: `Bearer ${remoteTools!.token}` } },
          }),
        );
        expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
          "find_files",
          "read_file",
          "write_file",
          "create_file",
        ]);
        const result = await client.callTool({
          name: "create_file",
          arguments: { path: "hello.txt", content: "owner-funded edit\n" },
        });
        expect(result.isError).toBe(false);
        append("Created hello.txt");
        return null;
      } catch (error) {
        providerError = error;
        throw error;
      } finally {
        await client.close();
      }
    },
  );
  const server = createServer((req, res) => {
    void service.fileTools
      .handle(req, res, new URL(req.url!, "http://localhost").pathname)
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch(() => {
        res.writeHead(500);
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  service.fileTools.setOrigin(`http://127.0.0.1:${address.port}`);
  const projectLocation = { kind: "posix" as const, path: root };
  const grant = { projectLocation, ...(await local.open({ projectLocation })) };
  try {
    const room = service.createRoom("Friends");
    const members = Array.from({ length: 105 }, (_, index) => {
      const { code } = service.createInvite({
        label: `Friend ${index}`,
        roomId: room.id,
        models: [model.id],
        durationMinutes: 10,
        redeemWithinMinutes: 60,
        turnLimit: 0,
      });
      const token = shareSecret();
      service.redeem(code, token, "");
      return service.roomMember(token);
    });
    const author = members[0]!;
    const runner = members[104]!;
    const page = service.rooms.snapshot(author, undefined, false);
    expect(page.members).toHaveLength(100);
    expect(
      service.rooms.snapshot(author, undefined, false, page.nextMemberCursor).members,
    ).toHaveLength(5);
    service.rooms.setReady(runner, true);
    const first = {
      id: randomUUID(),
      model: model.id,
      prompt: "Create hello.txt",
      runner: runner.id,
    };
    service.rooms.submit(author, first, false);
    service.rooms.submit(author, { ...first, id: randomUUID(), prompt: "Next turn" }, false);
    const lease = randomUUID();
    expect(service.rooms.claim(runner, first.id, lease, false).execution).toBe("owner");
    let done = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = service.rooms.fileRequests(runner, first.id, lease, false);
      for (const request of state.requests)
        service.rooms.fileResult(
          runner,
          first.id,
          lease,
          request.id,
          await local.execute({ ...grant, requestId: request.id, tool: request.tool }),
          false,
        );
      if (state.providerDone) {
        done = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(done).toBe(true);
    expect(providerError).toBeUndefined();
    expect(await readFile(join(root, "hello.txt"), "utf8")).toBe("owner-funded edit\n");
    expect(
      service.rooms.snapshot(author, undefined, false).turns?.map((turn) => turn.status),
    ).toEqual(["running", "queued"]);
    await local.end(grant);
    service.rooms.finish(runner, first.id, lease, "complete", "untrusted client reply", false);
    expect(service.rooms.snapshot(author, undefined, false).turns?.[0]).toMatchObject({
      status: "complete",
      reply: "Created hello.txt",
    });
  } finally {
    await local.close();
    await service.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
