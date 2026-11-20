// ViscosityCode: the prompt surface's shell hook must not change its upstream look.
import { describe, expect, it } from "vitest";
import { chatMessageSurfaceClass, chatPromptSurfaceClass } from "./chatMessageSurface";

describe("chatPromptSurfaceClass", () => {
  it("adds only the unstyled shell hook to upstream's utilities", () => {
    const classes = chatPromptSurfaceClass.split(" ");
    expect(classes[0]).toBe("poracode-chat-prompt-surface");
    expect(classes.slice(1)).toEqual([
      ...chatMessageSurfaceClass.split(" "),
      "relative",
      "border",
      "border-[var(--hairline)]",
    ]);
  });
});
