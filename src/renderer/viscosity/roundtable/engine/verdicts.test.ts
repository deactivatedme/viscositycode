import { describe, expect, it } from "vitest";
import { findMentions, parsePick, parseVerdict, tallyPicks } from "./verdicts";

describe("parseVerdict", () => {
  it("reads the last VERDICT line", () => {
    expect(parseVerdict("Looks good.\nVERDICT: APPROVE")).toBe("approve");
    expect(parseVerdict("- add tests\nVERDICT: REVISE")).toBe("revise");
    // The instruction may be quoted earlier; the final line wins.
    expect(parseVerdict('End with "VERDICT: APPROVE" or...\nVERDICT: REVISE')).toBe("revise");
    expect(parseVerdict("VERDICT: REVISE\n…fixed…\nVERDICT: APPROVE")).toBe("approve");
  });

  it("tolerates markdown, case and synonyms", () => {
    expect(parseVerdict("**VERDICT: APPROVE**")).toBe("approve");
    expect(parseVerdict("> verdict: approved")).toBe("approve");
    expect(parseVerdict("Verdict: changes requested")).toBe("revise");
    expect(parseVerdict("## VERDICT: reject")).toBe("revise");
  });

  it("is undefined without a verdict line", () => {
    expect(parseVerdict("I approve of this approach.")).toBeUndefined();
    expect(parseVerdict("The verdict is APPROVE")).toBeUndefined();
  });
});

const candidates = [
  { id: "a", label: "Claude Code · Opus" },
  { id: "b", label: "Codex" },
  { id: "c", label: "Codex (2)" },
];

describe("parsePick", () => {
  it("matches the exact label, case-insensitively", () => {
    expect(parsePick("Reasons…\nPICK: Codex", candidates)).toBe("b");
    expect(parsePick("PICK: claude code · opus", candidates)).toBe("a");
    expect(parsePick("**PICK: Codex (2)**", candidates)).toBe("c");
  });

  it("matches numbers and labels followed by more text", () => {
    expect(parsePick("PICK: 3", candidates)).toBe("c");
    expect(parsePick("PICK: #1", candidates)).toBe("a");
    expect(parsePick("PICK: Codex (2) because it is tested", candidates)).toBe("c");
  });

  it("uses the last valid pick and ignores unknown names", () => {
    expect(parsePick("PICK: Codex\nPICK: Nobody", candidates)).toBe("b");
    expect(parsePick("PICK: Nobody", candidates)).toBeUndefined();
    expect(parsePick("No pick here", candidates)).toBeUndefined();
  });
});

describe("tallyPicks", () => {
  it("returns the majority", () => {
    expect(tallyPicks(["b", "b", "a"], ["a", "b", "c"]).winner).toBe("b");
  });

  it("breaks ties toward the first proposer", () => {
    expect(tallyPicks(["c", "b"], ["a", "b", "c"]).winner).toBe("b");
    expect(tallyPicks([undefined, "x"], ["a", "b"]).winner).toBe("a");
  });
});

describe("findMentions", () => {
  it("finds @labels without matching longer names", () => {
    expect(findMentions("@Codex can you check?", candidates)).toEqual(["b"]);
    expect(findMentions("ask @codex (2) and @Claude Code · Opus", candidates)).toEqual(["a", "c"]);
    expect(findMentions("@Codexy is not a participant", candidates)).toEqual([]);
  });

  it("accepts the handle and an unambiguous provider or model name, any case", () => {
    const seats = [
      { id: "a", label: "Claude Code · Opus 4.5" },
      { id: "b", label: "Codex · GPT-5" },
      { id: "c", label: "Codex · GPT-5 mini" },
    ];
    expect(findMentions("@Claude please fix", seats)).toEqual(["a"]);
    expect(findMentions("@opus 4.5, thoughts?", seats)).toEqual(["a"]);
    expect(findMentions("@codex-gpt-5 please review", seats)).toEqual(["b"]);
    expect(findMentions("@gpt-5 mini and @Codex · GPT-5", seats)).toEqual(["b", "c"]);
    // "Codex" and "GPT-5" name two seats, so they name nobody.
    expect(findMentions("@Codex please review", seats)).toEqual([]);
    expect(findMentions("mail me@claude", seats)).toEqual([]);
  });

  it("never reads an npm scope or a path as a mention", () => {
    const seats = [
      { id: "a", label: "Qwen Code · Coder" },
      { id: "b", label: "Claude Code · Opus 4.5" },
    ];
    expect(findMentions("npm i -g @qwen-code/qwen-code", seats)).toEqual([]);
    expect(findMentions("see @claude.ai or @claude/docs", seats)).toEqual([]);
    expect(findMentions("thanks @Claude.", seats)).toEqual(["b"]);
  });
});
