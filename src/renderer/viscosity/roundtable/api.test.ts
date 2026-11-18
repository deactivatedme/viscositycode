import { beforeEach, describe, expect, it, vi } from "vitest";
import { postToRoundtable } from "./api";
import { agentSeat, makeSession } from "./engine/testFixtures";
import { useRoundtableStore } from "./roundtableStore";
import type { RoundtableSession } from "./types";

const runner = vi.hoisted(() => ({
  post: vi.fn<(sessionId: string, text: string, mentions: readonly string[] | undefined) => void>(),
}));

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));
// The live engine (threads, races) is not needed to check what a post accepts.
vi.mock("./engine/runtime", () => ({
  getRoundtableRuntime: () => ({ runner }),
  startRoundtableSession: vi.fn<() => Promise<string>>(),
}));

const seats = [agentSeat("a", "Alpha"), agentSeat("b", "Beta")];

function put(status: RoundtableSession["status"]): void {
  useRoundtableStore.setState({
    sessions: { "session-1": makeSession("open", seats, { status }) },
  });
}

beforeEach(() => {
  runner.post.mockReset();
  useRoundtableStore.setState({ sessions: {} });
});

describe("postToRoundtable", () => {
  it("hands a message for a running or paused session to the engine", async () => {
    put("running");
    await postToRoundtable("session-1", "  @Alpha hi  ", { mentions: ["a"] });
    expect(runner.post).toHaveBeenCalledWith("session-1", "@Alpha hi", ["a"]);
    put("paused");
    await postToRoundtable("session-1", "later");
    expect(runner.post).toHaveBeenLastCalledWith("session-1", "later", undefined);
  });

  it("rejects a message nobody would answer instead of dropping it silently", async () => {
    await expect(postToRoundtable("missing", "hello")).rejects.toThrow(
      "This Roundtable no longer exists.",
    );
    for (const status of ["done", "stopped", "failed"] as const) {
      put(status);
      await expect(postToRoundtable("session-1", "hello")).rejects.toThrow(
        "This Roundtable has ended. Start a new one to continue.",
      );
    }
    expect(runner.post).not.toHaveBeenCalled();
  });

  it("ignores an empty message", async () => {
    await expect(postToRoundtable("missing", "   ")).resolves.toBeUndefined();
    expect(runner.post).not.toHaveBeenCalled();
  });
});
