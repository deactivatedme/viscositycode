import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ParticipantProfile,
  RoundtableSession,
  RoundtableTurn,
} from "@/renderer/viscosity/roundtable/types";
import { createFakeXaiBridge, type FakeXaiBridge } from "./testing/fakeXaiBridge";
import { XaiParticipantDriver, trimXaiHistory } from "./XaiParticipantDriver";

let lightweight = false;
vi.mock("@/renderer/viscosity/performance/lightweight", () => ({
  isLightweightActive: () => lightweight,
}));

function profile(overrides: Partial<ParticipantProfile> = {}): ParticipantProfile {
  return {
    id: "grok",
    label: "Grok",
    role: "reviewer",
    brain: {
      kind: "xai",
      model: "grok-4.7",
      region: "global",
      tools: { webSearch: true, xSearch: false },
    },
    instructions: "  You review code.  ",
    ...overrides,
  };
}

function turn(overrides: Partial<RoundtableTurn>): RoundtableTurn {
  return {
    id: "t",
    participantId: "grok",
    round: 1,
    prompt: "p",
    status: "done",
    ...overrides,
  };
}

let ids = 0;
function driverWith(
  bridge: FakeXaiBridge,
  options: { session?: Pick<RoundtableSession, "turns"> } = {},
) {
  return new XaiParticipantDriver({
    profile: profile(),
    getBridge: () => bridge,
    createRequestId: () => `req-${++ids}`,
    ...options,
  });
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("XaiParticipantDriver", () => {
  let bridge: FakeXaiBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = createFakeXaiBridge();
    ids = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the prompt with model, region, tools and instructions, and returns the final text", async () => {
    const driver = driverWith(bridge);
    const pending = driver.sendTurn("Review the diff");
    expect(bridge.requests).toEqual([
      {
        requestId: "req-1",
        model: "grok-4.7",
        region: "global",
        input: [{ role: "user", content: "Review the diff" }],
        tools: { webSearch: true, xSearch: false },
        instructions: "You review code.",
      },
    ]);
    bridge.emit({ requestId: "req-1", type: "delta", text: "Looks " });
    bridge.emit({ requestId: "req-1", type: "done", text: "Looks good. APPROVE" });
    await expect(pending).resolves.toEqual({ status: "done", text: "Looks good. APPROVE" });
    expect(bridge.listenerCount()).toBe(0);
    expect(driver.threadId()).toBeUndefined();
  });

  it("keeps the conversation and re-sends it on the next turn", async () => {
    const driver = driverWith(bridge);
    const first = driver.sendTurn("Q1");
    bridge.emit({ requestId: "req-1", type: "done", text: "A1" });
    await first;
    const second = driver.sendTurn("Q2");
    expect(bridge.requests[1]?.input).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
    bridge.emit({ requestId: "req-2", type: "done", text: "A2" });
    await second;
    expect(driver.conversation()).toHaveLength(4);
  });

  it("throttles live progress to at most 8 updates a second", async () => {
    const driver = driverWith(bridge);
    const progress: string[] = [];
    const pending = driver.sendTurn("Go", (text) => progress.push(text));
    bridge.emit({ requestId: "req-1", type: "delta", text: "a" });
    expect(progress).toEqual(["a"]);
    for (const piece of ["b", "c", "d"]) {
      vi.advanceTimersByTime(10);
      bridge.emit({ requestId: "req-1", type: "delta", text: piece });
    }
    expect(progress).toEqual(["a"]);
    vi.advanceTimersByTime(125);
    expect(progress).toEqual(["a", "abcd"]);
    vi.advanceTimersByTime(1000);
    expect(progress).toEqual(["a", "abcd"]);
    bridge.emit({ requestId: "req-1", type: "delta", text: "e" });
    expect(progress).toEqual(["a", "abcd", "abcde"]);
    bridge.emit({ requestId: "req-1", type: "delta", text: "f" });
    bridge.emit({ requestId: "req-1", type: "done", text: "abcdef" });
    await pending;
    vi.advanceTimersByTime(1000);
    // Nothing fires after the turn settled.
    expect(progress).toEqual(["a", "abcd", "abcde"]);
  });

  it("throttles live progress to 2 updates a second in Lightweight mode", async () => {
    const driver = driverWith(bridge);
    lightweight = true;
    const progress: string[] = [];
    const pending = driver.sendTurn("Go", (text) => progress.push(text));
    lightweight = false;
    bridge.emit({ requestId: "req-1", type: "delta", text: "a" });
    bridge.emit({ requestId: "req-1", type: "delta", text: "b" });
    vi.advanceTimersByTime(125);
    expect(progress).toEqual(["a"]);
    vi.advanceTimersByTime(375);
    expect(progress).toEqual(["a", "ab"]);
    bridge.emit({ requestId: "req-1", type: "done", text: "ab" });
    await pending;
  });

  it("ignores events for other requests", async () => {
    const driver = driverWith(bridge);
    const pending = driver.sendTurn("Go");
    bridge.emit({ requestId: "someone-else", type: "done", text: "nope" });
    bridge.emit({ requestId: "req-1", type: "done", text: "mine" });
    await expect(pending).resolves.toEqual({ status: "done", text: "mine" });
  });

  it("returns failed on an error event and does not keep the failed exchange", async () => {
    const driver = driverWith(bridge);
    const pending = driver.sendTurn("Go");
    bridge.emit({ requestId: "req-1", type: "delta", text: "Part" });
    bridge.emit({ requestId: "req-1", type: "error", message: "English", code: "rate-limited" });
    await expect(pending).resolves.toEqual({
      status: "failed",
      text: "Part",
      error: "xAI rate limit reached. Try again in a moment.",
    });
    expect(driver.conversation()).toEqual([]);
  });

  it("returns failed when the bridge refuses the request", async () => {
    bridge.respond = () =>
      Promise.reject(new Error("No handler registered for 'viscosity:xai:respond'"));
    const result = await driverWith(bridge).sendTurn("Go");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("desktop app");
    expect(bridge.listenerCount()).toBe(0);
  });

  it("stop() cancels in main and settles the turn as stopped with the partial text", async () => {
    const driver = driverWith(bridge);
    const pending = driver.sendTurn("Go");
    bridge.emit({ requestId: "req-1", type: "delta", text: "Half" });
    await driver.stop();
    await expect(pending).resolves.toEqual({ status: "stopped", text: "Half" });
    expect(bridge.cancelled).toEqual(["req-1"]);
    bridge.emit({ requestId: "req-1", type: "done", text: "late" });
    expect(driver.conversation()).toEqual([]);
    // A new turn can start right away.
    const next = driver.sendTurn("Again");
    bridge.emit({ requestId: "req-2", type: "done", text: "ok" });
    await expect(next).resolves.toMatchObject({ status: "done" });
  });

  it("refuses a second turn while one is running", async () => {
    const driver = driverWith(bridge);
    void driver.sendTurn("One");
    await expect(driver.sendTurn("Two")).resolves.toMatchObject({ status: "failed" });
    expect(bridge.requests).toHaveLength(1);
  });

  it("dispose() stops the running turn, removes listeners and ignores later turns", async () => {
    const driver = driverWith(bridge);
    const pending = driver.sendTurn("Go", () => undefined);
    driver.dispose();
    await settleMicrotasks();
    await expect(pending).resolves.toMatchObject({ status: "stopped" });
    expect(bridge.cancelled).toEqual(["req-1"]);
    expect(bridge.listenerCount()).toBe(0);
    await expect(driver.sendTurn("After")).resolves.toEqual({ status: "stopped", text: "" });
    expect(bridge.requests).toHaveLength(1);
  });

  it("rebuilds the conversation from this participant's finished turns", async () => {
    const driver = driverWith(bridge, {
      session: {
        turns: [
          turn({ prompt: "Q1", responseText: "A1" }),
          turn({ participantId: "claude", prompt: "other", responseText: "x" }),
          turn({ prompt: "Q2", status: "failed", responseText: "partial" }),
          turn({ prompt: "Q3", responseText: "A3" }),
        ],
      },
    });
    void driver.sendTurn("Q4");
    expect(bridge.requests[0]?.input).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q3" },
      { role: "assistant", content: "A3" },
      { role: "user", content: "Q4" },
    ]);
  });

  it("ensureStarted checks availability, the US model guard and the key", async () => {
    await expect(driverWith(bridge).ensureStarted()).resolves.toBeUndefined();

    bridge.keyStatusValue = { configured: false, source: "none" };
    await expect(driverWith(bridge).ensureStarted()).rejects.toMatchObject({ code: "no-key" });

    const usDriver = new XaiParticipantDriver({
      profile: profile({
        brain: {
          kind: "xai",
          model: "grok-latest",
          region: "us",
          tools: { webSearch: false, xSearch: false },
        },
      }),
      getBridge: () => bridge,
    });
    await expect(usDriver.ensureStarted()).rejects.toMatchObject({ code: "region-model" });

    const offline = { ...createFakeXaiBridge(), available: false };
    const offlineDriver = new XaiParticipantDriver({
      profile: profile(),
      getBridge: () => offline,
    });
    await expect(offlineDriver.ensureStarted()).rejects.toMatchObject({ code: "unavailable" });
    await expect(offlineDriver.sendTurn("x")).resolves.toMatchObject({ status: "failed" });
  });

  it("only accepts xAI brains", () => {
    expect(
      () =>
        new XaiParticipantDriver({
          profile: profile({
            brain: { kind: "agent", agentKind: "any", model: "m", presentationMode: "gui" },
          }),
          getBridge: () => bridge,
        }),
    ).toThrow(/xAI brain/u);
    expect(driverWith(bridge).participantId).toBe("grok");
  });

  it("reads the instructions per request, so an edit or a removal applies mid-chat", () => {
    let current: string | undefined = "Be terse.";
    const driver = new XaiParticipantDriver({
      profile: profile(),
      instructions: () => current,
      getBridge: () => bridge,
    });
    void driver.sendTurn("Q1");
    expect(bridge.requests[0]?.instructions).toBe("Be terse.");
    bridge.emit({ requestId: bridge.requests[0]!.requestId, type: "done", text: "A1" });

    current = undefined;
    void driver.sendTurn("Q2");
    expect(bridge.requests[1]).not.toHaveProperty("instructions");
  });
});

describe("trimXaiHistory", () => {
  it("drops the oldest messages to fit and never starts on an assistant reply", () => {
    const messages = [
      { role: "user" as const, content: "aaaa" },
      { role: "assistant" as const, content: "bbbb" },
      { role: "user" as const, content: "cccc" },
      { role: "assistant" as const, content: "dddd" },
      { role: "user" as const, content: "ee" },
    ];
    expect(trimXaiHistory(messages, 100)).toEqual(messages);
    expect(trimXaiHistory(messages, 10)).toEqual(messages.slice(2));
    expect(trimXaiHistory(messages, 7)).toEqual(messages.slice(4));
    expect(trimXaiHistory(messages, 1)).toEqual(messages.slice(4));
  });
});
