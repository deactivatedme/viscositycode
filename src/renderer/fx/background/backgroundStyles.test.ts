// ViscosityCode: guards on background.css. jsdom does not apply CSS, so the
// rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/renderer/fx/background/background.css"), "utf8");

function rules(): Rule[] {
  const found: Rule[] = [];
  parse(css).walkRules((rule) => {
    found.push(rule);
  });
  return found;
}

function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) => selector.replace(/\s+/g, " ").trim());
}

function declarations(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules()) {
    if (!selectorsOf(rule).includes(selector)) continue;
    rule.walkDecls((decl) => {
      out.set(
        decl.prop,
        decl.value.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim(),
      );
    });
  }
  return out;
}

describe("background.css", () => {
  it("scopes every rule to the fork desktop shell", () => {
    for (const rule of rules()) {
      for (const selector of selectorsOf(rule)) {
        expect(selector).toMatch(/^html\[data-vc-shell\]/);
      }
    }
  });

  it("only makes panels translucent while the background runs", () => {
    for (const rule of rules()) {
      for (const selector of selectorsOf(rule)) {
        if (selector.includes(".vc-bg-layer")) continue;
        expect(selector).toMatch(/^html\[data-vc-shell\]\[data-vc-bg="on"\]/);
      }
    }
  });

  it("keeps the layer behind the app and out of hit-testing", () => {
    const layer = declarations("html[data-vc-shell] .vc-bg-layer");
    expect(layer.get("position")).toBe("fixed");
    expect(layer.get("inset")).toBe("0");
    expect(layer.get("z-index")).toBe("-1");
    expect(layer.get("pointer-events")).toBe("none");
  });

  it("paints main content and the sidebar with the panel alpha and backdrop", () => {
    for (const selector of [
      'html[data-vc-shell][data-vc-bg="on"] .poracode-shell[data-vc-activitybar] main::before',
      'html[data-vc-shell][data-vc-bg="on"] .poracode-shell[data-vc-activitybar] > .poracode-sidebar-aside:not(.poracode-sidebar-aside--overlay)::before',
    ]) {
      const fill = declarations(selector);
      expect(fill.get("background")).toContain("var(--vc-panel-alpha)");
      expect(fill.get("background")).toMatch(/^color-mix\(in oklab,/);
      expect(fill.get("backdrop-filter")).toBe("var(--vc-panel-backdrop)");
      expect(fill.get("pointer-events")).toBe("none");
    }
    const root = declarations('html[data-vc-shell][data-vc-bg="on"]');
    expect(root.get("--vc-panel-backdrop")).toBe("blur(var(--vc-panel-blur)) saturate(1.1)");
    expect(root.get("--vc-chrome-alpha")).toBe("clamp(0.4, var(--vc-panel-alpha), 1)");
  });

  it("never applies backdrop-filter to <main> itself (fixed descendants keep the viewport)", () => {
    const main = declarations(
      'html[data-vc-shell][data-vc-bg="on"] .poracode-shell[data-vc-activitybar] main',
    );
    expect(main.has("backdrop-filter")).toBe(false);
    expect(main.get("background")).toBe("transparent");
  });

  it("leaves terminals and editors alone", () => {
    expect(css).not.toMatch(/\.xterm|monaco/);
  });
});
