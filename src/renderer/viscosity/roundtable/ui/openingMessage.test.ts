import { beforeEach, describe, expect, it, vi } from "vitest";
import { postOpeningMessage } from "./openingMessage";
import { participant } from "./roundtable.testFixtures";

const api = vi.hoisted(() => ({
  postToRoundtable:
    vi.fn<(id: string, text: string, options?: { mentions?: string[] }) => Promise<void>>(),
}));

vi.mock("../api", () => ({ postToRoundtable: api.postToRoundtable }));

const seats = [participant("a"), participant("b")];

beforeEach(() => {
  api.postToRoundtable.mockReset().mockResolvedValue(undefined);
});

describe("postOpeningMessage", () => {
  it("posts the trimmed text to everyone when nobody is mentioned", async () => {
    await postOpeningMessage("rt1", "  Hello, team  ", seats);
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt1", "Hello, team", undefined);
  });

  it("sends the @mentioned participants, like the composer", async () => {
    await postOpeningMessage("rt1", "@AGENT-B and @agent-a: who starts?", seats);
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt1", "@AGENT-B and @agent-a: who starts?", {
      mentions: ["b", "a"],
    });
  });

  it("posts nothing for empty text", async () => {
    await postOpeningMessage("rt1", "", seats);
    await postOpeningMessage("rt1", " \n\t ", seats);
    expect(api.postToRoundtable).not.toHaveBeenCalled();
  });

  it("rejects like postToRoundtable", async () => {
    api.postToRoundtable.mockRejectedValueOnce(new Error("This Roundtable no longer exists."));
    await expect(postOpeningMessage("gone", "Hi", seats)).rejects.toThrow(
      "This Roundtable no longer exists.",
    );
  });
});
