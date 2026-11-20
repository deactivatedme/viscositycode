// ViscosityCode (fork of Poracode): Cursor CLI/ACP ids for every Claude family.
import { describe, expect, it } from "vitest";
import { formatCursorBaseModelLabel } from "./modelLabels";

describe("formatCursorBaseModelLabel", () => {
  it("labels the Fable family like the other Claude families", () => {
    expect(formatCursorBaseModelLabel("claude-fable-5-2")).toBe("Fable 5.2");
    expect(formatCursorBaseModelLabel("claude-opus-5-5")).toBe("Opus 5.5");
  });
});
