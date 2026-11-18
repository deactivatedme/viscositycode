// ViscosityCode: guards on the Roundtable stylesheet. jsdom does not apply
// CSS, so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AtRule, parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const UI_DIR = join(process.cwd(), "src/renderer/viscosity/roundtable/ui");
const css = readFileSync(join(UI_DIR, "roundtable.css"), "utf8");
const entry = readFileSync(join(process.cwd(), "src/renderer/viscosity/viscosity.css"), "utf8");

function rules(): Rule[] {
  const found: Rule[] = [];
  parse(css).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as AtRule).name)) return;
    found.push(rule);
  });
  return found;
}

describe("Roundtable stylesheet", () => {
  it("is loaded by the fork stylesheet entry", () => {
    expect(entry).toContain('@import "./roundtable/ui/roundtable.css";');
  });

  it("scopes every rule to the desktop shell, leaving compact/PWA untouched", () => {
    for (const rule of rules()) {
      for (const selector of rule.selectors) {
        expect(selector.replace(/\s+/g, " ").trim()).toMatch(/^html\[data-vc-shell\]/);
      }
    }
  });

  it("uses fork tokens instead of literal colours", () => {
    parse(css).walkDecls((decl) => {
      expect([decl.prop, decl.value]).not.toEqual([
        decl.prop,
        expect.stringMatching(/#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(/i),
      ]);
    });
  });

  it("keeps colour indicators but drops their motion for reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
    expect(css).not.toMatch(/@keyframes/);
  });
});
