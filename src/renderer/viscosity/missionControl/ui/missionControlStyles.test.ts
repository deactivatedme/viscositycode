// ViscosityCode: guards on the Mission Control stylesheet. jsdom does not apply
// CSS, so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AtRule, parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src/renderer/viscosity/missionControl/ui/missionControl.css"),
  "utf8",
);

function rules(): Rule[] {
  const found: Rule[] = [];
  parse(css).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as AtRule).name)) return;
    found.push(rule);
  });
  return found;
}

describe("Mission Control stylesheet", () => {
  it("scopes every rule to the desktop shell, leaving compact/PWA untouched", () => {
    for (const rule of rules()) {
      for (const selector of rule.selectors) {
        expect(selector.replace(/\s+/g, " ").trim()).toMatch(/^html\[data-vc-shell\]/);
      }
    }
  });

  it("tints live cards with a hairline border, not a glow", () => {
    parse(css).walkDecls("box-shadow", (decl) => {
      expect(decl.value).not.toContain("--vc-mc-state");
    });
    const tinted = rules().find((rule) =>
      rule.nodes.some(
        (n) =>
          n.type === "decl" &&
          n.prop === "border-color" &&
          n.value === "color-mix(in oklab, var(--vc-mc-state) 40%, var(--vc-border-subtle))",
      ),
    );
    expect(tinted?.selector).toMatch(/\.vc-mc-card:is\(/);
    for (const state of ["working", "attention", "error"]) {
      expect(tinted?.selector).toContain(`[data-vc-mc-state="${state}"]`);
    }
  });

  it("keeps a visible keyboard focus ring on cards", () => {
    expect(css).toMatch(
      /\.vc-mc-card:has\(\.vc-mc-card__open:focus-visible\) \{\s*box-shadow: 0 0 0 2px var\(--vc-focus-ring\)/,
    );
  });

  it("keeps pill radii for the status dot only", () => {
    for (const rule of rules()) {
      if (!rule.nodes.some((n) => n.type === "decl" && n.value.includes("--vc-radius-pill")))
        continue;
      for (const selector of rule.selectors) expect(selector).toMatch(/__dot$/);
    }
  });

  it("drives every animation and transition timing from the motion tokens", () => {
    parse(css).walkDecls(/^(animation|transition)/, (decl) => {
      expect(decl.value).not.toMatch(/(^|[\s(,])[\d.]+m?s\b/);
    });
  });

  it("keys nothing off the removed animated-background attributes", () => {
    expect(css).not.toMatch(/data-vc-bg-/);
  });
});
