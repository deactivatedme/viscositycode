import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRoundtableParticipants, postToRoundtable, updateRoundtableInstructions } from "./api";
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

function put(
  status: RoundtableSession["status"],
  pattern: RoundtableSession["pattern"] = "open",
  overrides: Partial<RoundtableSession> = {},
): void {
  useRoundtableStore.setState({
    sessions: { "session-1": makeSession(pattern, seats, { status, ...overrides }) },
  });
}

function stored(): RoundtableSession {
  return useRoundtableStore.getState().sessions["session-1"]!;
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
      put(status, "debate");
      await expect(postToRoundtable("session-1", "hello")).rejects.toThrow(
        "This Roundtable has ended. Start a new one to continue.",
      );
    }
    expect(runner.post).not.toHaveBeenCalled();
  });

  it("hands a message for a stopped open chat to the engine, which reopens it", async () => {
    put("stopped");
    await postToRoundtable("session-1", "continue");
    expect(runner.post).toHaveBeenCalledWith("session-1", "continue", undefined);
  });

  it("ignores an empty message", async () => {
    await expect(postToRoundtable("missing", "   ")).resolves.toBeUndefined();
    expect(runner.post).not.toHaveBeenCalled();
  });
});

describe("updateRoundtableInstructions", () => {
  it("sets, replaces and removes shared and per-seat instructions, and stamps the edit", async () => {
    put("running", "open", { instructions: "Old." });
    await updateRoundtableInstructions("session-1", {
      shared: "  Be brief.  ",
      participants: { a: "Own the backend.", ghost: "ignored" },
    });
    expect(stored().instructions).toBe("Be brief.");
    expect(stored().participants[0]!.instructions).toBe("Own the backend.");
    expect(stored().participants).toHaveLength(2);
    // The shared text changed: every seat is told again.
    expect(stored().instructionsUpdatedFor?.a).toBeGreaterThan(0);
    expect(stored().instructionsUpdatedFor?.b).toBeGreaterThan(0);

    await updateRoundtableInstructions("session-1", { participants: { a: " " } });
    expect(stored().instructions).toBe("Be brief.");
    expect(stored().participants[0]).not.toHaveProperty("instructions");
    await updateRoundtableInstructions("session-1", { shared: "" });
    expect(stored()).not.toHaveProperty("instructions");
  });

  it("stamps only the seats whose instructions really changed", async () => {
    put("running", "open", { instructions: "Shared." });
    await updateRoundtableInstructions("session-1", {
      shared: " Shared. ",
      participants: { a: "Own the backend.", b: "" },
    });
    expect(Object.keys(stored().instructionsUpdatedFor ?? {})).toEqual(["a"]);
    expect(stored()).not.toHaveProperty("instructionsUpdatedAt");
  });

  it("rejects a session that is gone", async () => {
    await expect(updateRoundtableInstructions("missing", { shared: "x" })).rejects.toThrow(
      "This Roundtable no longer exists.",
    );
  });
});

describe("addRoundtableParticipants", () => {
  it("seats newcomers in an open chat once, stamped with when they joined", async () => {
    put("running");
    await addRoundtableParticipants("session-1", [
      agentSeat("a", "Alpha"),
      agentSeat("c", "Gamma"),
    ]);
    expect(stored().participants.map((participant) => participant.id)).toEqual(["a", "b", "c"]);
    expect(stored().participants[2]!.joinedAt).toBeGreaterThan(0);
    expect(stored().participants[0]).not.toHaveProperty("joinedAt");
  });

  it("refuses other patterns and more than five seats without writing", async () => {
    put("running", "debate");
    await expect(addRoundtableParticipants("session-1", [agentSeat("c", "Gamma")])).rejects.toThrow(
      "Only a team chat can take new participants.",
    );
    put("running");
    const many = ["c", "d", "e", "f"].map((id) => agentSeat(id, id));
    await expect(addRoundtableParticipants("session-1", many)).rejects.toThrow(/up to 5/);
    expect(stored().participants).toHaveLength(2);
  });
});
