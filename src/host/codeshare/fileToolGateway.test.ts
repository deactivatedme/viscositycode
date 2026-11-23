import { expect, it } from "vitest";
import { ShareFileWorkspace } from "./fileToolGateway";

it("dispatches one file request until acknowledgement and cancels queued successors on Stop", async () => {
  const workspace = new ShareFileWorkspace("http://127.0.0.1:8788");
  const first = workspace.invoke({ name: "create_file", path: "first.txt", content: "a" });
  const second = workspace.invoke({ name: "create_file", path: "second.txt", content: "b" });
  const observed = second.catch((error: unknown) => error);
  try {
    const requests = workspace.requests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tool).toMatchObject({ path: "first.txt" });
    expect(workspace.requests()).toEqual(requests);
    workspace.respond(requests[0]!.id, { ok: true, value: { written: true } });
    expect(await first).toEqual({ ok: true, value: { written: true } });
    expect(workspace.requests()[0]?.tool).toMatchObject({ path: "second.txt" });
    workspace.stop();
    expect(workspace.requests()).toEqual([]);
    expect(await observed).toMatchObject({ message: "The shared turn was stopped." });
  } finally {
    workspace.stop();
  }
});
