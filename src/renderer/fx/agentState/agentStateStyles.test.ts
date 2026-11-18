// ViscosityCode: guards on the agent-state effects stylesheet. jsdom does not
// apply CSS, so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AtRule, type Declaration, parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/renderer/fx/agentState/agentState.css"), "utf8");
const root = parse(css);

/** Keyframe steps (`0%`, `from`, …) are not style rules. */
function insideKeyframes(node: Rule): boolean {
  const parent = node.parent;
  return parent?.type === "atrule" && /keyframes$/.test((parent as AtRule).name);
}

function insideReducedMotion(node: Rule): boolean {
  const parent = node.parent;
  return (
    parent?.type === "atrule" &&
    (parent as AtRule).name === "media" &&
    (parent as AtRule).params.includes("prefers-reduced-motion")
  );
}

function styleRules(): Rule[] {
  const found: Rule[] = [];
  root.walkRules((rule) => {
    if (!insideKeyframes(rule)) found.push(rule);
  });
  return found;
}

function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) => selector.replace(/\s+/g, " ").trim());
}

describe("agent-state effects stylesheet", () => {
  it("scopes every rule to the desktop shell", () => {
    for (const rule of styleRules()) {
      for (const selector of selectorsOf(rule)) {
        expect(selector).toMatch(/^html\[data-vc-shell\]/);
      }
    }
  });

  it("animates only compositor-friendly properties", () => {
    const animated = new Set<string>();
    root.walkAtRules(/keyframes$/, (atRule) => {
      atRule.walkDecls((decl: Declaration) => {
        animated.add(decl.prop);
      });
    });
    expect([...animated].sort()).toEqual(["opacity", "scale", "transform"]);
    root.walkDecls("transition", (decl) => {
      expect(decl.value === "none" || /^opacity\b/.test(decl.value)).toBe(true);
    });
  });

  it("colours effects with tokens, never literals", () => {
    root.walkDecls((decl) => {
      if (!/color|background|box-shadow|border/.test(decl.prop)) return;
      expect(decl.value).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    });
  });

  it("drops motion but keeps colour under reduced motion", () => {
    const reduced = styleRules().filter(insideReducedMotion);
    const stopped = reduced
      .filter((rule) => rule.some((node) => node.type === "decl" && node.value === "none"))
      .flatMap(selectorsOf);
    for (const target of [
      "html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state]::after",
      "html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state]::before",
      "html[data-vc-shell] [data-vc-tab-id][data-vc-fx-state] .vc-tab__dot",
      "html[data-vc-shell] .vc-fx-spin",
      "html[data-vc-shell] .vc-fx-caret-ripple",
    ]) {
      expect(stopped).toContain(target);
    }
    for (const rule of reduced) {
      rule.walkDecls((decl) => {
        expect(decl.prop).not.toMatch(/^(background|border-color|--vc-fx-edge)$/);
      });
    }
  });

  it("pauses continuous motion while the window is hidden or unfocused", () => {
    const paused = styleRules()
      .filter((rule) =>
        rule.some(
          (node) =>
            node.type === "decl" && node.prop === "animation-play-state" && node.value === "paused",
        ),
      )
      .flatMap(selectorsOf);
    expect(paused.length).toBeGreaterThan(0);
    for (const selector of paused) {
      expect(selector).toMatch(
        /^html\[data-vc-shell\]:is\(\[data-app-hidden\], \[data-app-unfocused\]\)/,
      );
    }
  });

  it("uses the state tokens for each state", () => {
    for (const token of [
      "--vc-state-thinking",
      "--vc-state-tool",
      "--vc-state-attention",
      "--vc-state-error",
      "--vc-state-success",
      "--vc-state-working",
    ]) {
      expect(css).toContain(`var(${token})`);
    }
    expect(css).toContain("var(--vc-motion-pulse)");
    expect(css).toContain("var(--vc-fx-energy)");
  });
});
