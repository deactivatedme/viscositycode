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

  it("leaves the agent-state ring, glow and tab underline to the effects", () => {
    for (const rule of styleRules()) {
      for (const selector of selectorsOf(rule)) {
        // agentState.css owns the pane's ::before / ::after and the tab button's ::after.
        expect(selector).not.toMatch(/\[data-poracode-thread-pane\][^ >]*::(before|after)/);
        expect(selector).not.toContain("[data-vc-tab-id]");
        expect(selector).not.toContain("data-vc-fx-");
      }
    }
  });

  it("draws a 2px line on the pane header and a 2px marker on the tab edge", () => {
    const header = styleRules().find((rule) =>
      selectorsOf(rule).some((selector) => selector.endsWith("> [data-poracode-thread-header]")),
    );
    expect(header).toBeDefined();
    const headerSize = header!.nodes.find(
      (node) => node.type === "decl" && node.prop === "background-size",
    );
    expect(headerSize && "value" in headerSize ? headerSize.value : "").toBe("100% 2px");

    const tab = styleRules().find((rule) =>
      selectorsOf(rule).some((selector) =>
        selector.endsWith(`.vc-tab[${AGENT_KIND_ATTRIBUTE}]::before`),
      ),
    );
    expect(tab).toBeDefined();
    const tabWidth = tab!.nodes.find((node) => node.type === "decl" && node.prop === "width");
    expect(tabWidth && "value" in tabWidth ? tabWidth.value : "").toBe("2px");
  });
});
