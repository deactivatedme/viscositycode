import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CursorSdkWorkerEvent } from "./sdkWorkerProtocol";
import { createCursorSdkWorkerHarness } from "./sdkWorkerTestHarness";

// ViscosityCode: the worker's cloud branch against a fake SDK that records calls.
async function cloudHarness() {
  const harness = await createCursorSdkWorkerHarness(CLOUD_SDK);
  const calls = (): Array<Record<string, unknown>> =>
    readFileSync(join(harness.sdkRoot, "calls.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ...harness, calls };
}

const cloudCreate = { model: { id: "composer" }, cloud: { repos: [] }, agentId: "bc-fresh" };

describe("Cursor SDK worker cloud agents", () => {
  it("opens a resumed cloud agent from the worker cwd and reports its running run", async () => {
    const { client, calls } = await cloudHarness();
    const initialized = await client.initialize({
      resumeAgentId: "bc-running",
      createOptions: { model: { id: "composer" }, cloud: {} },
    });

    expect(initialized).toEqual({
      agentId: "bc-running",
      // The fake reports its cwd as the state root: the worker's own cwd.
      stateRoot: process.cwd(),
      activeRunId: "run-live",
    });
    expect(initialized).not.toHaveProperty("supportsSummarize");
    expect(calls()).toContainEqual({ op: "resume", agentId: "bc-running", cloud: {} });
    await client.dispose();
  });

  it("reports a resumed cloud agent Cursor does not know", async () => {
    const { client } = await cloudHarness();
    await expect(
      client.initialize({
        resumeAgentId: "bc-missing",
        createOptions: { model: { id: "composer" }, cloud: {} },
      }),
    ).resolves.toMatchObject({ agentId: "bc-missing", cloudAgentMissing: true });
    await client.dispose();
  });

  it("attaches to a cloud run by id and refuses attach on a local agent", async () => {
    const cloud = await cloudHarness();
    await cloud.client.initialize({
      resumeAgentId: "bc-running",
      createOptions: { model: { id: "composer" }, cloud: {} },
    });
    const events: CursorSdkWorkerEvent[] = [];
    cloud.client.onEvent((event) => events.push(event));
    await expect(cloud.client.attach("run-live")).resolves.toEqual({ runId: "run-live" });
    await expect
      .poll(() => events.some((event) => event.type === "result" && event.runId === "run-live"))
      .toBe(true);
    expect(cloud.calls()).toContainEqual({
      op: "getRun",
      runId: "run-live",
      runtime: "cloud",
      agentId: "bc-running",
    });
    await cloud.client.dispose();

    const local = await cloudHarness();
    await local.client.initialize({
      createOptions: { model: { id: "composer" }, local: { cwd: local.directory } },
    });
    await expect(local.client.attach("run-live")).rejects.toThrow(/cloud agent run/);
    await local.client.dispose();
  });

  it("adopts the agent when the first send hits agent_id_conflict and sends once on it", async () => {
    const { client, calls } = await cloudHarness();
    await client.initialize({ createOptions: cloudCreate });
    await expect(client.start({ message: "conflict" })).resolves.toEqual({ runId: "run-1" });

    const sends = calls().filter((call) => call.op === "send");
    expect(sends).toEqual([
      { op: "send", agentId: "bc-fresh", handle: "created", message: "conflict" },
      { op: "send", agentId: "bc-fresh", handle: "resumed", message: "conflict" },
    ]);
    expect(calls()).toContainEqual({ op: "resume", agentId: "bc-fresh", cloud: {} });
    expect(calls()).toContainEqual({ op: "dispose", handle: "created" });
    await client.dispose();
  });

  it("rethrows agent_id_conflict on a resumed agent", async () => {
    const { client, calls } = await cloudHarness();
    await client.initialize({
      resumeAgentId: "bc-fresh",
      createOptions: { model: { id: "composer" }, cloud: {} },
    });
    await expect(client.start({ message: "conflict-always" })).rejects.toThrow(/conflict/);
    expect(calls().filter((call) => call.op === "resume")).toHaveLength(1);
    expect(calls().filter((call) => call.op === "send")).toHaveLength(1);
    await client.dispose();
  });
});

const CLOUD_SDK = String.raw`
import { appendFileSync } from "node:fs";

const log = (entry) =>
  appendFileSync(new URL("./calls.log", import.meta.url), JSON.stringify(entry) + "\n");
let runs = 0;

function conflict() {
  return Object.assign(new Error("agent id conflict"), { status: 409, code: "agent_id_conflict" });
}

function run(id) {
  return {
    id,
    status: "finished",
    async *stream() {
      yield { type: "assistant", agent_id: "bc", run_id: id,
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] } };
    },
    async wait() { return { id, status: "finished" }; },
    async cancel() {},
  };
}

function handle(agentId, kind) {
  return {
    agentId,
    async send(message) {
      log({ op: "send", agentId, handle: kind, message });
      if (message === "conflict-always" || (message === "conflict" && kind === "created")) {
        throw conflict();
      }
      return run("run-" + ++runs);
    },
    async summarize() { return run("summary"); },
    async reload() {},
    close() { log({ op: "dispose", handle: kind }); },
  };
}

export const Agent = {
  messages: { async list() { return []; } },
  async create(options) {
    log({ op: "create", agentId: options.agentId, cloud: options.cloud });
    return handle(options.agentId ?? "agent-local", "created");
  },
  async resume(agentId, options) {
    log({ op: "resume", agentId, cloud: options.cloud });
    return handle(agentId, "resumed");
  },
  async list() { return { items: [] }; },
  async get(agentId) { return { agentId }; },
  async listRuns(agentId) {
    if (agentId === "bc-missing") {
      throw Object.assign(new Error("not found"), { status: 404, code: "not_found" });
    }
    return { items: agentId === "bc-running" ? [{ ...run("run-live"), status: "running" }] : [] };
  },
  async getRun(runId, options) {
    log({ op: "getRun", runId, runtime: options.runtime, agentId: options.agentId });
    return run(runId);
  },
};
export const Cursor = { models: { async list() { return []; } } };
export function getDefaultSdkStateRoot(cwd) { return cwd; }
`;
