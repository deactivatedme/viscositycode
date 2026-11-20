// ViscosityCode: guards on the per-agent marker styles. jsdom does not apply
// CSS, so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { AGENT_ACCENT_CSS, AGENT_KIND_ATTRIBUTE } from "./api";
import { AGENT_COLORS_ENABLED_ATTRIBUTE } from "./runtime";

const css = readFileSync(join(import.meta.dirname, "agentColors.css"), "utf8");
const root = parse(css);

function styleRules(): Rule[] {
  const found: Rule[] = [];
  root.walkRules((rule) => {
    found.push(rule);
  });
  return found;
}

function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) => selector.replace(/\s+/g, " ").trim());
}

describe("agentColors.css", () => {
  it("applies only in the desktop shell while the switch is on, to agent elements", () => {
    const rules = styleRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const selector of selectorsOf(rule)) {
        expect(selector.startsWith(`html[data-vc-shell][${AGENT_COLORS_ENABLED_ATTRIBUTE}] `)).toBe(
          true,
        );
        expect(selector).toContain(`[${AGENT_KIND_ATTRIBUTE}]`);
      }
    }
  });

  it("paints only the agent accent, with the theme accent as fallback", () => {
    const paints: string[] = [];
    root.walkDecls((decl) => {
      expect(decl.important ?? false).toBe(false);
      if (/^(background|background-image|box-shadow)$/.test(decl.prop)) {
        paints.push(decl.value.replace(/\s+/g, " "));
      }
    });
    expect(paints.length).toBeGreaterThan(0);
    for (const value of paints) expect(value).toContain(AGENT_ACCENT_CSS);
  });

  it("leaves the pane's pseudo-elements and the agent-state attributes alone", () => {
    for (const rule of styleRules()) {
      for (const selector of selectorsOf(rule)) {
        expect(selector).not.toMatch(/\[data-poracode-thread-pane\][^ >]*::(before|after)/);
        expect(selector).not.toContain("[data-vc-tab-id]");
        expect(selector).not.toContain("data-vc-fx-");
      }
    }
  });

  it("draws a 2px line on the pane header", () => {
    const header = styleRules().find((rule) =>
      selectorsOf(rule).some((selector) => selector.endsWith("> [data-poracode-thread-header]")),
    );
    expect(header).toBeDefined();
    const headerSize = header!.nodes.find(
      (node) => node.type === "decl" && node.prop === "background-size",
    );
    expect(headerSize && "value" in headerSize ? headerSize.value : "").toBe("100% 2px");
    // The thread tabs are gone, so nothing styles a tab marker any more.
    expect(css).not.toContain(".vc-tab");
  });
});
