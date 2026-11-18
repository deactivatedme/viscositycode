import { describe, expect, it } from "vitest";
import type { PromptSegment } from "@/shared/contracts";
import { classifyTaskKind, taskKindInputFromSegments } from "./taskKind";

describe("classifyTaskKind", () => {
  it("reads code fences, file paths and coding verbs as coding work", () => {
    expect(classifyTaskKind({ text: "fix the failing test in parser.ts" })).toBe("coding");
    expect(classifyTaskKind({ text: "```ts\nconst a = 1;\n```\nwhy is this slow" })).toBe("coding");
    expect(classifyTaskKind({ text: "Refactor the settings module and add tests" })).toBe("coding");
  });

  it("reads short questions as quick questions", () => {
    expect(classifyTaskKind({ text: "what does this flag do?" })).toBe("quick");
    expect(classifyTaskKind({ text: "Explain the difference between a mutex and a lock" })).toBe(
      "quick",
    );
  });

  it("treats file or diff mentions as code context", () => {
    expect(classifyTaskKind({ text: "", hasCodeContext: true })).toBe("coding");
    expect(classifyTaskKind({ text: "tidy this up", hasCodeContext: true })).toBe("coding");
  });

  it("returns undefined when it cannot tell", () => {
    expect(classifyTaskKind({ text: "" })).toBeUndefined();
    expect(classifyTaskKind({ text: "   " })).toBeUndefined();
    expect(classifyTaskKind({ text: "x".repeat(600) })).toBeUndefined();
  });
});

describe("taskKindInputFromSegments", () => {
  it("joins text segments and flags file mentions as code context", () => {
    const segments = [
      { kind: "text", content: "look at " },
      { kind: "file", path: "/repo/src/a.ts" },
      { kind: "text", content: " please" },
    ] as unknown as PromptSegment[];
    expect(taskKindInputFromSegments(segments)).toEqual({
      text: "look at  please",
      hasCodeContext: true,
    });
  });

  it("has no code context for plain text", () => {
    const segments = [{ kind: "text", content: "hello?" }] as PromptSegment[];
    expect(taskKindInputFromSegments(segments)).toEqual({ text: "hello?", hasCodeContext: false });
  });
});
