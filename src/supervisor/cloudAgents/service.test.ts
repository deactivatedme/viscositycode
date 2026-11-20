import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { msg } from "@/shared/messages";
import type { AgentAdapter } from "../agents/base";
import {
  CloudAgentSourceError,
  type CloudAgentSource,
  type CloudAgentSourceDetail,
  type CloudAgentSourceSummary,
} from "../agents/base/cloudAgents";
import {
  CLOUD_AGENT_FOLLOW_MAX_MESSAGES,
  CLOUD_AGENTS_BACKOFF_MAX_MS,
  CLOUD_AGENTS_CACHE_TTL_MS,
  CLOUD_AGENTS_REQUEST_TIMEOUT_MS,
  CloudAgentsService,
} from "./service";

const summary = (id: string, updatedAt = "2026-11-20T00:00:00.000Z"): CloudAgentSourceSummary => ({
  id,
  providerSessionId: `ref:${id}`,
  name: `Agent ${id}`,
  status: "finished",
  updatedAt,
  repos: [],
});

function fakeSource<O extends Partial<CloudAgentSource> = object>(overrides = {} as O) {
  return {
    listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => ({ items: [summary("a1")] })),
    getAgent: vi.fn<CloudAgentSource["getAgent"]>(async (id): Promise<CloudAgentSourceDetail> => ({
      ...summary(id),
      branches: [],
    })),
    readTranscript: vi.fn<CloudAgentSource["readTranscript"]>(async () => ({
      messages: [
        { role: "user", text: "fix it" },
        { role: "assistant", text: "done" },
      ],
    })),
    providerSessionId: (id: string) => `ref:${id}`,
    ...overrides,
  } satisfies CloudAgentSource;
}

function setup(sources: Record<string, CloudAgentSource | undefined>) {
  const adapters = new Map(
    Object.entries(sources).map(([kind, cloudAgents]) => [
      kind,
      { kind, ...(cloudAgents ? { cloudAgents } : {}) } as AgentAdapter,
    ]),
  );
  let now = 1_000_000;
  const emit = vi.fn<(event: SupervisorEvent) => void>();
  const service = new CloudAgentsService(adapters, emit, () => now);
  return {
    service,
    adapters,
    emit,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CloudAgentsService list", () => {
  it("lists only adapters with a cloud source and tags items with their agent kind", async () => {
    const source = fakeSource();
    const { service } = setup({ cloud: source, local: undefined });

    const result = await service.list({});

    expect(result.sources).toEqual([
      { agentKind: "cloud", items: [{ ...summary("a1"), agentKind: "cloud" }] },
    ]);
    expect((await service.list({ agentKind: "local" })).sources).toEqual([]);
  });

  it("serves the cache within the TTL, refetches after it, and refresh skips it", async () => {
    const source = fakeSource();
    const { service, advance } = setup({ cloud: source });

    await service.list({});
    await service.list({});
    expect(source.listAgents).toHaveBeenCalledTimes(1);

    await service.list({ refresh: true });
    expect(source.listAgents).toHaveBeenCalledTimes(2);

    advance(CLOUD_AGENTS_CACHE_TTL_MS);
    await service.list({});
    expect(source.listAgents).toHaveBeenCalledTimes(3);
  });

  it("caps a page at 50 items and passes the cursor through", async () => {
    const items = Array.from({ length: 60 }, (_, index) => summary(`a${index}`));
    const source = fakeSource({
      listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => ({
        items,
        nextCursor: "next",
      })),
    });
    const { service } = setup({ cloud: source });

    const [listing] = (await service.list({ cursor: "c1" })).sources;

    expect(listing?.items).toHaveLength(50);
    expect(listing?.nextCursor).toBe("next");
    expect(source.listAgents).toHaveBeenCalledWith("c1");
  });

  it("sends one request at a time per source and shares an in-flight page", async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    const source = fakeSource({
      listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        active -= 1;
        return { items: [summary("a1")] };
      }),
    });
    const { service } = setup({ cloud: source });

    const first = service.list({ refresh: true });
    const second = service.list({ refresh: true });
    const detail = service.get({ agentKind: "cloud", agentId: "a1" });
    await vi.waitFor(() => expect(source.listAgents).toHaveBeenCalledTimes(1));
    expect(source.getAgent).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second, detail]);

    expect(source.listAgents).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);
    expect(source.getAgent).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After, then backs off exponentially up to the cap, keeping the stale page", async () => {
    const listAgents = vi.fn<CloudAgentSource["listAgents"]>(async () => ({
      items: [summary("a1")],
    }));
    const source = fakeSource({ listAgents });
    const { service, advance } = setup({ cloud: source });
    await service.list({});

    listAgents.mockRejectedValueOnce(
      new CloudAgentSourceError("rate_limited", "slow down", { retryAfterMs: 5_000 }),
    );
    const limited = (await service.list({ refresh: true })).sources[0];
    expect(limited?.error).toEqual({ code: "rate_limited", retryAfterMs: 5_000 });
    expect(limited?.items).toHaveLength(1);

    // Refresh does not bypass the backoff.
    advance(4_000);
    const waiting = (await service.list({ refresh: true })).sources[0];
    expect(waiting?.error).toEqual({ code: "rate_limited", retryAfterMs: 1_000 });
    expect(listAgents).toHaveBeenCalledTimes(2);

    // Later failures without Retry-After keep escalating from the 60 s base, capped at 15 min.
    const delays: number[] = [];
    listAgents.mockRejectedValue(new Error("network down"));
    advance(1_000);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const failed = (await service.list({ refresh: true })).sources[0];
      expect(failed?.error?.code).toBe("unavailable");
      delays.push(failed?.error?.retryAfterMs ?? 0);
      advance(failed?.error?.retryAfterMs ?? 0);
    }
    expect(delays).toEqual([
      120_000,
      240_000,
      480_000,
      900_000,
      900_000,
      CLOUD_AGENTS_BACKOFF_MAX_MS,
    ]);

    // A success resets the escalation.
    listAgents.mockResolvedValue({ items: [] });
    expect((await service.list({ refresh: true })).sources[0]?.error).toBeUndefined();
    listAgents.mockRejectedValueOnce(new Error("blip"));
    expect((await service.list({ refresh: true })).sources[0]?.error?.retryAfterMs).toBe(60_000);
  });

  it("caps a provider Retry-After at the backoff maximum", async () => {
    const source = fakeSource({
      listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => {
        throw new CloudAgentSourceError("rate_limited", "slow down", {
          retryAfterMs: 24 * 60 * 60_000,
        });
      }),
    });
    const { service } = setup({ cloud: source });

    const [listing] = (await service.list({})).sources;

    expect(listing?.error).toEqual({
      code: "rate_limited",
      retryAfterMs: CLOUD_AGENTS_BACKOFF_MAX_MS,
    });
  });

  it("times out a hung source call so later requests still run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const listAgents = vi.fn<CloudAgentSource["listAgents"]>(() => new Promise(() => {}));
    const source = fakeSource({ listAgents });
    const { service, advance } = setup({ cloud: source });

    const hung = service.list({});
    await vi.advanceTimersByTimeAsync(CLOUD_AGENTS_REQUEST_TIMEOUT_MS);
    expect((await hung).sources[0]?.error).toEqual({ code: "unavailable", retryAfterMs: 60_000 });

    advance(60_000);
    listAgents.mockResolvedValueOnce({ items: [summary("a2")] });
    const [listing] = (await service.list({})).sources;
    expect(listing?.error).toBeUndefined();
    expect(listing?.items.map((item) => item.id)).toEqual(["a2"]);
  });

  it("starts fresh when the adapter's source is rebuilt", async () => {
    const broken = fakeSource({
      listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => {
        throw new CloudAgentSourceError("unavailable", "down");
      }),
    });
    const { service, adapters } = setup({ cloud: broken });
    expect((await service.list({})).sources[0]?.error?.code).toBe("unavailable");

    const rebuilt = fakeSource();
    adapters.set("cloud", {
      kind: "cloud",
      cloudAgents: rebuilt as CloudAgentSource,
    } as AgentAdapter);
    const [listing] = (await service.list({})).sources;

    expect(listing?.error).toBeUndefined();
    expect(rebuilt.listAgents).toHaveBeenCalledTimes(1);
  });

  it("does not back off on auth errors and keeps other sources visible", async () => {
    const broken = fakeSource({
      listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => {
        throw new CloudAgentSourceError("auth", "bad key");
      }),
    });
    const { service } = setup({ broken, healthy: fakeSource() });

    const { sources } = await service.list({});

    expect(sources.find((s) => s.agentKind === "broken")).toEqual({
      agentKind: "broken",
      items: [],
      error: { code: "auth" },
    });
    expect(sources.find((s) => s.agentKind === "healthy")?.items).toHaveLength(1);
    await service.list({ refresh: true });
    expect(broken.listAgents).toHaveBeenCalledTimes(2);
  });
});

describe("CloudAgentsService get", () => {
  it("caches detail by updatedAt and truncates long results", async () => {
    const getAgent = vi.fn<CloudAgentSource["getAgent"]>(async (id) => ({
      ...summary(id),
      latestRun: { status: "finished", result: "x".repeat(10_000) },
      branches: [],
    }));
    const listAgents = vi.fn<CloudAgentSource["listAgents"]>(async () => ({
      items: [summary("a1")],
    }));
    const { service } = setup({ cloud: fakeSource({ getAgent, listAgents }) });
    await service.list({});

    const detail = await service.get({ agentKind: "cloud", agentId: "a1" });
    await service.get({ agentKind: "cloud", agentId: "a1" });
    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(detail.agentKind).toBe("cloud");
    expect(detail.latestRun?.result?.length).toBeLessThanOrEqual(4_097);

    listAgents.mockResolvedValueOnce({ items: [summary("a1", "2026-11-21T00:00:00.000Z")] });
    await service.list({ refresh: true });
    await service.get({ agentKind: "cloud", agentId: "a1" });
    expect(getAgent).toHaveBeenCalledTimes(2);
  });

  it("rejects during a backoff without calling the source", async () => {
    const source = fakeSource({
      listAgents: vi.fn<CloudAgentSource["listAgents"]>(async () => {
        throw new CloudAgentSourceError("rate_limited", "slow down", { retryAfterMs: 5_000 });
      }),
    });
    const { service } = setup({ cloud: source });
    await service.list({});

    await expect(service.get({ agentKind: "cloud", agentId: "a1" })).rejects.toMatchObject({
      code: "rate_limited",
      message: msg("cloudAgents.backingOff"),
      retryAfterMs: 5_000,
    });
    expect(source.getAgent).not.toHaveBeenCalled();
  });

  it("reports a non-source failure with the localized unavailable message", async () => {
    const source = fakeSource({
      getAgent: vi.fn<CloudAgentSource["getAgent"]>(async () => {
        throw new Error("socket hang up");
      }),
    });
    const { service } = setup({ cloud: source });

    await expect(service.get({ agentKind: "cloud", agentId: "a1" })).rejects.toMatchObject({
      code: "unavailable",
      message: msg("cloudAgents.unavailable"),
    });
  });

  it("rejects an agent kind without a cloud source", async () => {
    const { service } = setup({ local: undefined });
    await expect(service.get({ agentKind: "local", agentId: "a1" })).rejects.toThrow(
      msg("cloudAgents.unsupported"),
    );
  });
});

describe("CloudAgentsService follow", () => {
  const payload = { threadId: "thread-1", agentKind: "cloud", agentId: "a1" };

  it("checks the agent, replays its conversation, then records the resume reference", async () => {
    const source = fakeSource({
      getAgent: vi.fn<CloudAgentSource["getAgent"]>(async (id) => ({
        ...summary(id),
        status: "running" as const,
        branches: [],
      })),
    });
    const { service, emit } = setup({ cloud: source });

    await expect(service.follow(payload)).resolves.toEqual({ messageCount: 2, running: true });

    const events = emit.mock.calls.map(([event]) => event);
    const replayed = events.flatMap((event) =>
      event.type === "thread-runtime-events" ? event.events : [],
    );
    expect(replayed.map((event: RuntimeEvent) => event.type)).toEqual([
      "item.started",
      "item.completed",
      "item.started",
      "content.delta",
      "item.completed",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "thread-state",
      threadId: "thread-1",
      agentKind: "cloud",
      status: "inactive",
      attention: "none",
      canResumeWithConfig: true,
      sessionRef: { providerSessionId: "ref:a1" },
    });
    expect(source.getAgent.mock.invocationCallOrder[0]).toBeLessThan(
      source.readTranscript.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("emits nothing when the key cannot see the agent", async () => {
    const source = fakeSource({
      getAgent: vi.fn<CloudAgentSource["getAgent"]>(async () => {
        throw new CloudAgentSourceError("auth", "not yours");
      }),
    });
    const { service, emit } = setup({ cloud: source });

    await expect(service.follow(payload)).rejects.toMatchObject({ code: "auth" });
    expect(source.readTranscript).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind and a concurrent follow of the same agent", async () => {
    let release!: () => void;
    const source = fakeSource({
      readTranscript: vi.fn<CloudAgentSource["readTranscript"]>(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { messages: [] };
      }),
    });
    const { service } = setup({ cloud: source });

    await expect(service.follow({ ...payload, agentKind: "nope" })).rejects.toThrow(
      msg("cloudAgents.unsupported"),
    );
    const first = service.follow(payload);
    await expect(service.follow({ ...payload, threadId: "thread-2" })).rejects.toThrow(
      msg("cloudAgents.followInProgress"),
    );
    await vi.waitFor(() => expect(source.readTranscript).toHaveBeenCalled());
    release();
    await expect(first).resolves.toEqual({ messageCount: 0, running: false });
  });

  it("keeps the newest messages when the conversation is over the bound", async () => {
    const messages = Array.from({ length: CLOUD_AGENT_FOLLOW_MAX_MESSAGES + 5 }, (_, index) => ({
      role: "assistant" as const,
      text: `m${index}`,
    }));
    const source = fakeSource({
      readTranscript: vi.fn<CloudAgentSource["readTranscript"]>(async () => ({ messages })),
    });
    const { service, emit } = setup({ cloud: source });

    const result = await service.follow(payload);

    expect(result).toMatchObject({
      messageCount: CLOUD_AGENT_FOLLOW_MAX_MESSAGES,
      truncated: true,
    });
    const deltas = emit.mock.calls.flatMap(([event]) =>
      event.type === "thread-runtime-events"
        ? event.events.flatMap((e) => (e.type === "content.delta" ? [e.delta] : []))
        : [],
    );
    expect(deltas[0]).toBe("m5");
    expect(deltas.at(-1)).toBe(`m${CLOUD_AGENT_FOLLOW_MAX_MESSAGES + 4}`);
  });
});
