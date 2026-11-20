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

  it("also finds a participant by label or an unambiguous provider or model name", () => {
    const handles = mentionHandles([
      { id: "a", label: "Claude Code · Opus 4.5" },
      { id: "b", label: "Codex · GPT-5" },
    ]);
    expect(extractMentions("@Claude fix the tests", handles)).toEqual(["a"]);
    expect(extractMentions("@codex · gpt-5 and @opus", handles)).toEqual(["b", "a"]);
    expect(extractMentions("@claude-code-opus-4-5 fix", handles)).toEqual(["a"]);
    // Two seats share "Claude · Opus": its words name neither one.
    expect(extractMentions("@claude hi", mentionHandles(participants))).toEqual([]);
  });

  it("inserts and removes mention tokens", () => {
    expect(insertMention("", "claude-opus")).toBe("@claude-opus ");
    expect(insertMention("hi", "claude-opus")).toBe("hi @claude-opus ");
    expect(insertMention("hi ", "claude-opus")).toBe("hi @claude-opus ");
    expect(removeMention("@claude-opus please @claude-opus-2 review", "claude-opus")).toBe(
      "please @claude-opus-2 review",
    );
  });

  it("removes every form that names the participant, so its chip toggles off", () => {
    const handles = mentionHandles([
      { id: "a", label: "Claude Code · Opus 4.5" },
      { id: "b", label: "Codex · GPT-5" },
    ]);
    const handle = handles.get("a")!;
    for (const text of [
      "@Claude hi",
      "@Claude Code · Opus 4.5 hi",
      "@claude-code-opus-4-5 hi @opus and @Codex · GPT-5",
    ]) {
      const removed = removeMention(text, handle, handles);
      expect(extractMentions(removed, handles)).not.toContain("a");
    }
    expect(removeMention("@Claude hi", handle, handles)).toBe("hi");
    expect(removeMention("ask @Claude, then @codex", handle, handles)).toBe("ask , then @codex");
  });
});
