import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, it } from "vitest";
import {
  appClaimResponseSchema,
  appRedeemResponseSchema,
  parseModel,
  type ChatMessage,
} from "@/shared/codeShare";
import type { RuntimeEvent } from "@/shared/contracts";
import { startCodeShareHttp } from "@/host/codeshare/http";
import { CodeShareService } from "@/host/codeshare/service";
import { CodeShareStore, shareSecret } from "@/host/codeshare/store";
import { CodeShareFileRuntime } from "../../codeShareFileRuntime";
import { ProjectTreeService } from "../../projectTree";
import type { StructuredSessionHandle } from "../base";
import { CodeShareProjectConnections } from "./connection";
import { createCodeShareProjectAdapter } from "./index";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

it("redeems a desktop-only invite into normal project sessions with approval, usage and isolated history", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeshare-project-fixture-"));
  const project = join(root, "recipient-project");
  await mkdir(project);
  const guestPort = await freePort();
  const origin = "http://127.0.0.1:" + guestPort;
  const provider = {
    ...parseModel("claude:fixture"),
    execution: "owner-subscription" as const,
    remoteEditing: true as const,
  };
  const conversations: ChatMessage[][] = [];
  const service = new CodeShareService(
    new CodeShareStore(join(root, "share.sqlite")),
    origin,
    [provider],
    async ({ messages, append, remoteTools }) => {
      conversations.push(messages);
      const lastPrompt = messages.at(-1)?.content;
      const paths: Record<string, string> = {
        "Create a file": "hello.txt",
        "Pending stop": "stopped.txt",
        "Pending revocation": "revoked.txt",
      };
      const path = lastPrompt ? paths[lastPrompt] : undefined;
      if (path) {
        if (!remoteTools) throw new Error("No project tool bridge was granted.");
        const client = new Client({ name: "project-fixture", version: "1" });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(remoteTools.url), {
              requestInit: { headers: { Authorization: "Bearer " + remoteTools.token } },
            }),
          );
          const result = await client.callTool({
            name: "create_file",
            arguments: { path, content: "owner-funded project edit" },
          });
          if (result.isError) throw new Error("The project file tool was refused.");
        } finally {
          await client.close();
        }
      }
      append("Project reply");
      return { inputTokens: 13, outputTokens: 7 };
    },
  );
  const files = new CodeShareFileRuntime(new ProjectTreeService(), async () => false);
  const host = await startCodeShareHttp({
    adminPort: 0,
    guestPort,
    guestOrigin: origin,
    ownerToken: shareSecret(),
    service,
  });
  const sessions: StructuredSessionHandle[] = [];
  try {
    const invite = service.createInvite({
      label: "Friend",
      models: [provider.id],
      turnLimit: 6,
      durationMinutes: 60,
      redeemWithinMinutes: 60,
      desktopOnly: true,
    });
    const post = (path: string, data: object) =>
      fetch(origin + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    const landing = await fetch(origin + "/");
    const cookie = landing.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeDefined();
    const browser = await fetch(origin + "/api/v1/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie!, Origin: origin },
      body: JSON.stringify({ code: invite.code }),
    });
    expect(browser.status).toBe(409);
    const { claim } = appClaimResponseSchema.parse(
      await (await post("/api/v1/app/claim", {})).json(),
    );
    const oldApp = await post("/api/v1/app/redeem?desktop=1&room=2", { code: invite.code, claim });
    expect(oldApp.status).toBe(409);
    const { token, state } = appRedeemResponseSchema.parse(
      await (
        await post("/api/v1/app/redeem?desktop=1&project=1&room=2", { code: invite.code, claim })
      ).json(),
    );
    expect(state.projectProtocol).toBe(1);
    const shares = new CodeShareProjectConnections(root);
    await shares.configure({ action: "connect", origin, token });
    expect(await readFile(join(root, "codeshare-project-access.json"), "utf8")).not.toContain(
      token,
    );
    const adapter = createCodeShareProjectAdapter(new CodeShareProjectConnections(root), files);
    const catalog = await adapter.detectInstall();
    expect(catalog.capabilities).toMatchObject({
      presentationModes: ["gui"],
      models: [{ id: provider.id }],
    });
    const config = { model: provider.id };
    async function open() {
      const threadId = randomUUID();
      const session = (await adapter.createStructuredSession!({
        threadId,
        projectLocation: {
          kind: process.platform === "win32" ? "windows" : "posix",
          path: project,
        },
        config,
        presentationMode: "gui",
      }))!;
      sessions.push(session);
      const events: RuntimeEvent[] = [];
      session.setListener({
        onClose() {},
        onError() {},
        onUpdate() {},
        onRuntimeEvent: (event) => events.push(event),
      });
      await session.openThread!(config);
      return { threadId, session, events };
    }
    const first = await open();
    await first.session.startTurn!("Create a file", config);
    await expect.poll(() => first.events.some(({ type }) => type === "request.opened")).toBe(true);
    await expect(stat(join(project, "hello.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const approval = first.events.find((event) => event.type === "request.opened")!;
    await first.session.resolveServerRequest!(approval.requestId, { optionId: "allow" });
    await expect
      .poll(() => first.events.find(({ type }) => type === "turn.completed"))
      .toMatchObject({ state: "completed" });
    expect(await readFile(join(project, "hello.txt"), "utf8")).toBe("owner-funded project edit");
    expect(first.events).toContainEqual(expect.objectContaining({ type: "usage.spent" }));
    const second = await open();
    await second.session.startTurn!("Separate project chat", config);
    await expect.poll(() => second.events.some(({ type }) => type === "turn.completed")).toBe(true);
    await first.session.startTurn!("Continue first chat", config);
    await expect
      .poll(() => first.events.filter(({ type }) => type === "turn.completed").length)
      .toBe(2);
    expect(conversations.map((messages) => messages.map(({ content }) => content))).toEqual([
      ["Create a file"],
      ["Separate project chat"],
      ["Create a file", "Project reply", "Continue first chat"],
    ]);
    expect(service.guestState(token).turns).toEqual([]);
    expect(service.ownerState().invites[0]).toMatchObject({
      turnsUsed: 3,
      inputTokens: 39,
      outputTokens: 21,
      reportedUsageTurns: 3,
    });

    const stop = await open();
    await stop.session.startTurn!("Pending stop", config);
    await expect.poll(() => stop.events.some(({ type }) => type === "request.opened")).toBe(true);
    await stop.session.interruptTurn!();
    await expect(stat(join(project, "stopped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(stop.events).toContainEqual(
      expect.objectContaining({
        type: "turn.completed",
        state: "cancelled",
      }),
    );

    const revoked = await open();
    await revoked.session.startTurn!("Pending revocation", config);
    await expect
      .poll(() => revoked.events.some(({ type }) => type === "request.opened"))
      .toBe(true);
    service.revoke(service.ownerState().invites[0]!.id);
    const staleApproval = revoked.events.find((event) => event.type === "request.opened")!;
    await revoked.session.resolveServerRequest!(staleApproval.requestId, { optionId: "allow" });
    await expect
      .poll(() => revoked.events.some(({ type }) => type === "turn.completed"))
      .toBe(true);
    await expect(stat(join(project, "revoked.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await adapter.detectInstall()).installed).toBe(false);
  } finally {
    for (const session of sessions) await session.dispose();
    await files.close();
    await host.close();
    await service.close();
    await rm(root, { force: true, recursive: true });
  }
}, 15_000);
