import { afterEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  executeCodeShareFileTool: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  closeCodeShareWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));
vi.mock("./subscription", () => ({
  readCodeShareLocalProject: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
import { monitorRoomFiles } from "./roomFileWorker";
import type { CodeShareConnection } from "./client";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});
it("executes owner tool requests and waits for the local grant to drain before finishing the lease", async () => {
  vi.useFakeTimers();
  const draining = Promise.withResolvers<{ closed: true }>();
  bridge.closeCodeShareWorkspace.mockReturnValue(draining.promise);
  bridge.executeCodeShareFileTool.mockResolvedValue({ ok: true, value: { content: "text" } });
  const record = {
    version: 1 as const,
    id: crypto.randomUUID(),
    lease: crypto.randomUUID(),
    grant: {
      projectLocation: { kind: "posix" as const, path: "/approved" },
      grantId: crypto.randomUUID(),
      incarnation: crypto.randomUUID(),
    },
  };
  const requestId = crypto.randomUUID();
  const connection = {
    roomFileRequests: vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce({
        status: "running",
        providerDone: false,
        requests: [{ id: requestId, tool: { name: "read_file", path: "a.ts" } }],
      })
      .mockResolvedValue({ status: "stopping", providerDone: true, requests: [] }),
    roomFileResult: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    endRoomTurn: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
  };
  const task = monitorRoomFiles(connection as unknown as CodeShareConnection, "room", record);
  await vi.advanceTimersByTimeAsync(850);
  expect(bridge.executeCodeShareFileTool).toHaveBeenCalledWith({
    ...record.grant,
    requestId,
    tool: { name: "read_file", path: "a.ts" },
  });
  expect(connection.roomFileResult).toHaveBeenCalledOnce();
  expect(bridge.closeCodeShareWorkspace).toHaveBeenCalledWith(record.grant);
  expect(connection.endRoomTurn).not.toHaveBeenCalled();
  draining.resolve({ closed: true });
  await task;
  expect(connection.endRoomTurn).toHaveBeenCalledWith({
    id: record.id,
    lease: record.lease,
    outcome: "complete",
    reply: "",
  });
});
