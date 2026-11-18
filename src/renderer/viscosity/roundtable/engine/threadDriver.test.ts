import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptSegment } from "@/shared/contracts";
import type { TurnResult } from "../types";
import { agentSeat, makeSession } from "./testFixtures";
import { ThreadParticipantDriver } from "./threadDriver";
import type {
  DriverTiming,
  LastTurnRead,
  ThreadEnginePort,
  ThreadLaunchRequest,
  ThreadTurnSnapshot,
} from "./threadPort";

const TIMING: DriverTiming = {
  settleMs: 100,
  startGraceMs: { gui: 200, terminal: 500 },
  progressMs: 50,
};

function snapshot(patch: Partial<ThreadTurnSnapshot> = {}): ThreadTurnSnapshot {
  return {
    status: "idle",
    presentationMode: "gui",
    busyInBackground: false,
    mentionToolsAvailable: undefined,
    ...patch,
  };
}

/** A fake thread engine: a tiny store of thread snapshots with change listeners. */
class FakePort implements ThreadEnginePort {
  readonly snapshots = new Map<string, ThreadTurnSnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  readonly launches: ThreadLaunchRequest[] = [];
  readonly submits: Array<{ threadId: string; prompt: string; segments?: PromptSegment[] }> = [];
  readonly interrupts: string[] = [];
  retained = 0;
  released = 0;
  lastTurn: LastTurnRead = { text: "answer" };
  terminalText = "terminal output";
  liveText = "";
  mentionEnabled = false;
  launchPresentation: "gui" | "terminal" = "gui";

  set(threadId: string, patch: Partial<ThreadTurnSnapshot>): void {
    this.snapshots.set(threadId, { ...(this.snapshots.get(threadId) ?? snapshot()), ...patch });
    this.notify(threadId);
  }

  remove(threadId: string): void {
    this.snapshots.delete(threadId);
    this.notify(threadId);
  }

  private notify(threadId: string): void {
    for (const listener of this.listeners.get(threadId) ?? []) listener();
  }

  listenerCount(threadId: string): number {
    return this.listeners.get(threadId)?.size ?? 0;
  }

  snapshot(threadId: string) {
    return this.snapshots.get(threadId);
  }

  subscribe(threadId: string, listener: () => void) {
    const set = this.listeners.get(threadId) ?? new Set();
    set.add(listener);
    this.listeners.set(threadId, set);
    return () => set.delete(listener);
  }

  readLiveText() {
    return this.liveText;
  }

  async readLastTurn() {
    return this.lastTurn;
  }

  async readTerminalText() {
    return this.terminalText;
  }

  async createAndLaunch(request: ThreadLaunchRequest, onCreated: (threadId: string) => void) {
    this.launches.push(request);
    this.snapshots.set(
      "thread-new",
      snapshot({ status: "launching", presentationMode: this.launchPresentation }),
    );
    onCreated("thread-new");
    return "thread-new";
  }

  async submit(threadId: string, prompt: string, segments?: PromptSegment[]) {
    this.submits.push({ threadId, prompt, ...(segments ? { segments } : {}) });
    this.set(threadId, { status: "working" });
  }

  async interrupt(threadId: string) {
    this.interrupts.push(threadId);
  }

  retainReader() {
    this.retained += 1;
    return () => {
      this.released += 1;
    };
  }

  readThreadToolEnabled() {
    return this.mentionEnabled;
  }

  threadTitle() {
    return "Origin chat";
  }

  describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

function setup(boundThreadId?: string) {
  const port = new FakePort();
  if (boundThreadId) port.snapshots.set(boundThreadId, snapshot());
  const recorded: string[] = [];
  const profile = agentSeat("p1", "Builder", "builder");
  const session = makeSession("build-review", [profile, agentSeat("p2", "Reviewer", "reviewer")]);
  const driver = new ThreadParticipantDriver(
    profile,
    session,
    port,
    {
      lookupThreadId: () => boundThreadId ?? recorded.at(-1),
      recordThreadId: (threadId) => recorded.push(threadId),
    },
    TIMING,
  );
  return { port, driver, recorded };
}

/** Collects a promise's settlement without awaiting it. */
function track(promise: Promise<TurnResult>) {
  const state: { result?: TurnResult } = {};
  void promise.then((result) => {
    state.result = result;
  });
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ThreadParticipantDriver", () => {
  it("creates and launches the thread for the first turn, then reads the final answer", async () => {
    const { port, driver, recorded } = setup();
    const turn = track(driver.sendTurn("Do the task"));
    await vi.advanceTimersByTimeAsync(0);
    expect(port.launches).toHaveLength(1);
    expect(port.launches[0]!.prompt).toBe("Do the task");
    expect(port.launches[0]!.brain.model).toBe("model-1");
    expect(port.launches[0]!.segments).toBeUndefined();
    expect(recorded).toEqual(["thread-new"]);
    expect(driver.threadId()).toBe("thread-new");
    expect(port.retained).toBe(1);

    port.set("thread-new", { status: "working" });
    await vi.advanceTimersByTimeAsync(500);
    expect(turn.result).toBeUndefined();

    port.lastTurn = { text: "All done" };
    port.set("thread-new", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result).toEqual({ status: "done", text: "All done" });
    // The live-event reader is held only while the turn runs.
    expect(port.released).toBe(1);
    expect(port.listenerCount("thread-new")).toBe(0);
  });

  it("waits until a busy thread is idle before sending a follow-up", async () => {
    const { port, driver } = setup("thread-1");
    port.set("thread-1", { status: "working" });
    const turn = track(driver.sendTurn("Next step"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(port.submits).toHaveLength(0);

    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.submits).toEqual([{ threadId: "thread-1", prompt: "Next step" }]);

    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result).toEqual({ status: "done", text: "answer" });
  });

  it("does not end a turn while the thread flaps back to work or runs background work", async () => {
    const { port, driver } = setup("thread-1");
    const turn = track(driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs / 2);
    port.set("thread-1", { status: "working" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs * 2);
    expect(turn.result).toBeUndefined();

    port.set("thread-1", { status: "idle", busyInBackground: true });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs * 5);
    expect(turn.result).toBeUndefined();

    port.set("thread-1", { busyInBackground: false });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result?.status).toBe("done");
  });

  it("reports waiting for the user and never answers the request itself", async () => {
    const { port, driver } = setup("thread-1");
    const attention: boolean[] = [];
    const turn = track(
      driver.sendTurn("Go", undefined, { onAttention: (waiting) => attention.push(waiting) }),
    );
    await vi.advanceTimersByTimeAsync(0);
    port.set("thread-1", { status: "needs_approval" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attention).toEqual([true]);
    expect(turn.result).toBeUndefined();
    expect(port.submits).toHaveLength(1);

    port.set("thread-1", { status: "working" });
    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(attention).toEqual([true, false]);
    expect(turn.result?.status).toBe("done");
  });

  it("fails on an error status, an interrupted turn or a removed thread", async () => {
    const errored = setup("thread-1");
    const first = track(errored.driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    errored.port.set("thread-1", { status: "error", errorMessage: "Usage limit reached" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(first.result).toMatchObject({ status: "failed", error: "Usage limit reached" });

    const interrupted = setup("thread-2");
    const second = track(interrupted.driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    interrupted.port.set("thread-2", { status: "idle", interruptedTurn: "restart" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(second.result?.status).toBe("failed");

    const removed = setup("thread-3");
    const third = track(removed.driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    removed.port.remove("thread-3");
    await vi.advanceTimersByTimeAsync(0);
    expect(third.result?.status).toBe("failed");
  });

  it("fails an empty answer that reported an error item", async () => {
    const { port, driver } = setup("thread-1");
    port.lastTurn = { text: "", errorMessage: "Model overloaded" };
    const turn = track(driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result).toMatchObject({ status: "failed", error: "Model overloaded" });
  });

  it("stop interrupts the running turn and reports it stopped", async () => {
    const { port, driver } = setup("thread-1");
    const turn = track(driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    await driver.stop();
    expect(port.interrupts).toEqual(["thread-1"]);
    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result?.status).toBe("stopped");
  });

  it("stop while waiting for a busy thread sends nothing", async () => {
    const { port, driver } = setup("thread-1");
    port.set("thread-1", { status: "working" });
    // The thread is busy with something else: stopping must not interrupt it.
    const turn = track(driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    port.set("thread-1", { status: "needs_reply" });
    await driver.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(turn.result?.status).toBe("stopped");
    expect(port.submits).toHaveLength(0);
  });

  it("reads a terminal thread's scrollback instead of chat items", async () => {
    const { port, driver } = setup();
    port.launchPresentation = "terminal";
    port.terminalText = "Compiled. Tests pass.";
    const turn = track(driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(0);
    port.set("thread-new", { status: "working" });
    port.set("thread-new", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result).toEqual({ status: "done", text: "Compiled. Tests pass." });
  });

  it("treats a terminal turn that never visibly started as starting for a grace period", async () => {
    const { port, driver } = setup("thread-1");
    port.set("thread-1", { status: "idle", presentationMode: "terminal" });
    const submit = port.submit.bind(port);
    // A terminal status can lag the send: the thread stays idle at first.
    port.submit = async (threadId, prompt) => {
      port.submits.push({ threadId, prompt });
    };
    const turn = track(driver.sendTurn("Go"));
    await vi.advanceTimersByTimeAsync(TIMING.startGraceMs.terminal - 50);
    expect(turn.result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(50 + TIMING.settleMs);
    expect(turn.result?.status).toBe("done");
    port.submit = submit;
  });

  it("attaches thread references only when the participant can read them", async () => {
    const withTool = setup();
    withTool.port.mentionEnabled = true;
    void withTool.driver.sendTurn("Context please", undefined, { contextThreadIds: ["origin"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(withTool.port.launches[0]!.mentionHandoff).toBe(true);
    expect(withTool.port.launches[0]!.segments).toEqual([
      { kind: "text", content: "Context please" },
      { kind: "thread", threadId: "origin", title: "Origin chat" },
    ]);

    const withoutTool = setup();
    void withoutTool.driver.sendTurn("Context please", undefined, { contextThreadIds: ["origin"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(withoutTool.port.launches[0]!.segments).toBeUndefined();

    const followUp = setup("thread-1");
    followUp.port.set("thread-1", { mentionToolsAvailable: false });
    void followUp.driver.sendTurn("Again", undefined, { contextThreadIds: ["origin"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(followUp.port.submits[0]!.segments).toBeUndefined();
  });

  it("samples live text for the running turn at most every progress tick", async () => {
    const { port, driver } = setup("thread-1");
    const progress: string[] = [];
    const turn = track(driver.sendTurn("Go", (text) => progress.push(text)));
    await vi.advanceTimersByTimeAsync(0);
    port.liveText = "Hel";
    await vi.advanceTimersByTimeAsync(TIMING.progressMs);
    port.liveText = "Hello";
    await vi.advanceTimersByTimeAsync(TIMING.progressMs * 3);
    expect(progress).toEqual(["Hel", "Hello"]);
    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result?.status).toBe("done");
  });

  it("waits for a turn that is already running (race candidates, reloads)", async () => {
    const { port, driver } = setup("thread-1");
    port.set("thread-1", { status: "working" });
    const turn = track(driver.awaitCurrentTurn());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(turn.result).toBeUndefined();
    port.set("thread-1", { status: "idle" });
    await vi.advanceTimersByTimeAsync(TIMING.settleMs);
    expect(turn.result).toEqual({ status: "done", text: "answer" });
    expect(port.submits).toHaveLength(0);
    expect(port.launches).toHaveLength(0);
  });
});
