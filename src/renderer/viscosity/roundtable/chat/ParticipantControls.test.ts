import { describe, expect, it } from "vitest";
import { avatarBackground } from "./ParticipantControls";

describe("avatarBackground", () => {
  it("turns a bot's stored palette token into its theme variable", () => {
    expect(avatarBackground("accent")).toBe("var(--accent)");
    expect(avatarBackground("project-icon-blue")).toBe("var(--project-icon-blue)");
  });

  it("keeps custom properties, variables and literal colours usable", () => {
    expect(avatarBackground("--vc-accent")).toBe("var(--vc-accent)");
    expect(avatarBackground("var(--vc-accent)")).toBe("var(--vc-accent)");
    expect(avatarBackground("#3366ff")).toBe("#3366ff");
  });
});
