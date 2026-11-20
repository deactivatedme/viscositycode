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

  it("sets every label in sentence case (no uppercase or tracked caps)", () => {
    parse(css).walkDecls((decl) => {
      expect([decl.prop, decl.value]).not.toEqual(["text-transform", "uppercase"]);
      expect(decl.prop).not.toBe("letter-spacing");
    });
  });

  it("drops the fx background blur hook (Effects is gone)", () => {
    expect(css).not.toContain("data-vc-bg-blur");
  });

  it("uses fork tokens instead of literal colours", () => {
    parse(css).walkDecls((decl) => {
      expect([decl.prop, decl.value]).not.toEqual([
        decl.prop,
        expect.stringMatching(/#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(/i),
      ]);
    });
  });

  it("keeps pill radii for the status dots only (chips, seats, avatars are squared)", () => {
    for (const rule of rules()) {
      if (!rule.nodes.some((n) => n.type === "decl" && n.value.includes("--vc-radius-pill")))
        continue;
      for (const selector of rule.selectors) expect(selector).toMatch(/dot|typing/);
    }
  });

  it("tints live participant seats with a border, not a glow", () => {
    parse(css).walkDecls("box-shadow", (decl) => {
      expect(decl.value).not.toContain("--vc-rt-state");
    });
    expect(css).toMatch(
      /\.vc-rt-participant:not\(\[data-vc-fx-state="idle"\]\)\s*\{\s*border-color: color-mix\(in oklab, var\(--vc-rt-state\) 40%, var\(--vc-border-subtle\)\)/,
    );
  });

  it("drives every animation and transition timing from the motion tokens", () => {
    parse(css).walkDecls(/^(animation|transition)/, (decl) => {
      expect(decl.value).not.toMatch(/(^|[\s(,])[\d.]+m?s\b/);
    });
  });

  it("keeps colour indicators but drops their motion for reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
    expect(css).not.toMatch(/@keyframes/);
  });
});
