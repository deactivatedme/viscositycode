// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AGENT_COLOR_IDS,
  AGENT_COLOR_PALETTE,
  DEFAULT_AGENT_COLOR_POOL,
  DEFAULT_AGENT_COLOR_TIERS,
  agentColorCss,
  findAgentColor,
  isAgentColorId,
} from "./palette";

describe("agent colour palette", () => {
  it("has exactly one entry per colour id, in picker order", () => {
    expect(AGENT_COLOR_PALETTE.map((color) => color.id)).toEqual([...AGENT_COLOR_IDS]);
    for (const id of AGENT_COLOR_IDS) expect(findAgentColor(id).id).toBe(id);
  });

  it("builds every colour from theme tokens, never a literal", () => {
    for (const color of AGENT_COLOR_PALETTE) {
      // A token is `var(--x)` or a theme tint over the project-icon hue.
      const tokenRe = String.raw`var\(--[a-z-]+(, var\(--[a-z-]+\))?\)`;
      expect(color.css).toMatch(
        new RegExp(`^(${tokenRe}|color-mix\\(in oklch, ${tokenRe}, ${tokenRe}\\))$`),
      );
      expect(color.css).not.toMatch(/#|rgb\(|oklch\(\d/);
    }
    expect(agentColorCss("accent")).toBe("var(--vc-accent)");
  });

  it("hands out distinct palette colours that never read as a state", () => {
    expect(new Set(DEFAULT_AGENT_COLOR_POOL).size).toBe(DEFAULT_AGENT_COLOR_POOL.length);
    for (const id of DEFAULT_AGENT_COLOR_POOL) expect(isAgentColorId(id)).toBe(true);
    // The theme accent looks uncoloured; red and amber read as error / needs attention.
    expect(DEFAULT_AGENT_COLOR_POOL).not.toContain("accent");
    expect(DEFAULT_AGENT_COLOR_POOL).not.toContain("red");
    expect(DEFAULT_AGENT_COLOR_POOL).not.toContain("amber");
    expect(DEFAULT_AGENT_COLOR_POOL).toEqual(DEFAULT_AGENT_COLOR_TIERS.flat());
  });

  it("puts only plain token hues in the first tier, never the close in-between mixes", () => {
    for (const id of DEFAULT_AGENT_COLOR_TIERS[0]!) {
      expect(agentColorCss(id)).toBe(`var(--vc-agent-hue-${id}, var(--project-icon-${id}))`);
    }
  });

  it("recognises only palette ids", () => {
    expect(isAgentColorId("blue")).toBe(true);
    expect(isAgentColorId("Blue")).toBe(false);
    expect(isAgentColorId("#ff0000")).toBe(false);
    expect(isAgentColorId(3)).toBe(false);
    expect(isAgentColorId(undefined)).toBe(false);
  });
});
