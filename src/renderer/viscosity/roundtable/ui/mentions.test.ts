import { describe, expect, it } from "vitest";
import { extractMentions, insertMention, mentionHandles, removeMention } from "./mentions";

const participants = [
  { id: "a", label: "Claude · Opus" },
  { id: "b", label: "Claude · Opus" },
  { id: "c", label: "Grök 4.7" },
  { id: "d", label: "···" },
];

describe("mentions", () => {
  it("derives unique, typeable handles", () => {
    expect([...mentionHandles(participants).values()]).toEqual([
      "claude-opus",
      "claude-opus-2",
      "grok-4-7",
      "participant",
    ]);
  });

  it("finds mentioned participants in order, once each, ignoring case", () => {
    const handles = mentionHandles(participants);
    expect(
      extractMentions("@Claude-Opus-2 and @grok-4-7, then @claude-opus-2 again", handles),
    ).toEqual(["b", "c"]);
    expect(extractMentions("email@claude-opus.dev is not a mention", handles)).toEqual([]);
    expect(extractMentions("@unknown", handles)).toEqual([]);
  });

  it("inserts and removes mention tokens", () => {
    expect(insertMention("", "claude-opus")).toBe("@claude-opus ");
    expect(insertMention("hi", "claude-opus")).toBe("hi @claude-opus ");
    expect(insertMention("hi ", "claude-opus")).toBe("hi @claude-opus ");
    expect(removeMention("@claude-opus please @claude-opus-2 review", "claude-opus")).toBe(
      "please @claude-opus-2 review",
    );
  });
});
