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

/** Declarations of the non-reduced-motion rules that list `selector`. */
function declarationsOf(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of styleRules()) {
    if (insideReducedMotion(rule) || !selectorsOf(rule).includes(selector)) continue;
    rule.walkDecls((decl) => {
      out.set(decl.prop, decl.value.replace(/\s+/g, " ").trim());
    });
  }
  return out;
}

type Specificity = [number, number, number];

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Index of the bracket that closes the one at `open`. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/** Selectors Level 4 specificity for the selector grammar this stylesheet uses. */
function specificity(selector: string): Specificity {
  let total: Specificity = [0, 0, 0];
  const addTo = (part: Specificity) => {
    total = [total[0] + part[0], total[1] + part[1], total[2] + part[2]];
  };
  let index = 0;
  while (index < selector.length) {
    const char = selector[index]!;
    if (char === "[") {
      index = closingBracket(selector, index) + 1;
      addTo([0, 1, 0]);
    } else if (char === "#" || char === ".") {
      index += 1;
      while (index < selector.length && /[\w-]/.test(selector[index]!)) index += 1;
      addTo(char === "#" ? [1, 0, 0] : [0, 1, 0]);
    } else if (char === ":") {
      const pseudoElement = selector[index + 1] === ":";
      index += pseudoElement ? 2 : 1;
      const start = index;
      while (index < selector.length && /[\w-]/.test(selector[index]!)) index += 1;
      const name = selector.slice(start, index);
      let args = "";
      if (selector[index] === "(") {
        const end = closingBracket(selector, index);
        args = selector.slice(index + 1, end);
        index = end + 1;
      }
      if (pseudoElement) addTo([0, 0, 1]);
      else if (name === "is" || name === "not" || name === "has") {
        const parts = splitSelectorList(args).map(specificity);
        addTo(parts.reduce((best, part) => (compareSpecificity(part, best) > 0 ? part : best)));
      } else if (name !== "where") addTo([0, 1, 0]);
    } else if (/[a-z]/i.test(char)) {
      while (index < selector.length && /[\w-]/.test(selector[index]!)) index += 1;
      addTo([0, 0, 1]);
    } else {
      index += 1;
    }
  }
  return total;
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
      "html[data-vc-shell] [data-vc-tab-id][data-vc-fx-state]::after",
      'html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state="tool"] > [data-poracode-thread-header] .poracode-thread-pane-title::after',
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

  it("lets every per-state rule override the shared base it refines", () => {
    // Regression: a base written with :is([data-vc-fx-state]:not(...)) outranked
    // the per-state rules, so its opacity 0 and accent edge hid every steady state.
    const own = (selector: string, target: string, pseudo: string) =>
      selector.includes(target) &&
      selector.endsWith(pseudo) &&
      !/\[data-poracode-thread-header\]|\.vc-tab__dot|data-app-hidden/.test(selector);
    const violations: string[] = [];
    let compared = 0;
    for (const target of ["[data-poracode-thread-pane]", "[data-vc-tab-id]"]) {
      for (const pseudo of ["::before", "::after"]) {
        const selectors = styleRules()
          .filter((rule) => !insideReducedMotion(rule))
          .flatMap(selectorsOf)
          .filter((selector) => own(selector, target, pseudo));
        const bases = selectors.filter((selector) => /:(where|is)\(/.test(selector));
        const states = selectors.filter((selector) => !/:(where|is)\(/.test(selector));
        if (states.length > 0 && bases.length === 0) {
          violations.push(`no shared base for ${target}${pseudo}`);
        }
        for (const base of bases) {
          for (const state of states) {
            compared += 1;
            if (compareSpecificity(specificity(base), specificity(state)) >= 0) {
              violations.push(`${base} outranks or ties ${state}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
    expect(compared).toBeGreaterThan(20);
  });

  it("draws a visible pane ring and tab underline for every non-idle state", () => {
    for (const state of ["thinking", "tool", "attention", "error", "working"]) {
      const ring = declarationsOf(
        `html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state="${state}"]::after`,
      );
      expect(Number(ring.get("opacity"))).toBeGreaterThanOrEqual(0.6);
    }
    // Streaming scales with the output rate from a clearly visible floor.
    const streaming = declarationsOf(
      'html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state="streaming"]::after',
    );
    const scaled = (streaming.get("opacity") ?? "").match(
      /^calc\(([\d.]+) \+ ([\d.]+) \* var\(--vc-fx-energy\)\)$/,
    );
    expect(scaled).not.toBeNull();
    expect(Number(scaled?.[1])).toBeGreaterThanOrEqual(0.5);
    expect(Number(scaled?.[1]) + Number(scaled?.[2])).toBeCloseTo(1);
    for (const state of ["thinking", "tool", "streaming", "attention", "error", "working"]) {
      const underline = declarationsOf(
        `html[data-vc-shell] [data-vc-tab-id][data-vc-fx-state="${state}"]::after`,
      );
      expect(Number(underline.get("opacity"))).toBeGreaterThanOrEqual(0.5);
    }
    const baseSelector = styleRules()
      .flatMap(selectorsOf)
      .find((selector) =>
        /^html\[data-vc-shell\] \[data-poracode-thread-pane\]:where\(.*\)::after$/.test(selector),
      );
    expect(baseSelector).toBeDefined();
    // A crisp solid ring in the state colour under every state.
    expect(declarationsOf(baseSelector!).get("box-shadow")).toMatch(
      /^inset 0 0 0 var\(--vc-fx-ring\) var\(--vc-fx-edge\)/,
    );
    for (const [state, token] of [
      ["thinking", "--vc-state-thinking"],
      ["tool", "--vc-state-tool"],
      ["attention", "--vc-state-attention"],
      ["error", "--vc-state-error"],
    ] as const) {
      expect(
        declarationsOf(
          `html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state="${state}"]::after`,
        ).get("--vc-fx-edge"),
      ).toBe(`var(${token})`);
    }
  });

  it("keeps the tool spinner beside the title, clear of the header actions", () => {
    for (const selector of styleRules().flatMap(selectorsOf)) {
      expect(selector).not.toMatch(/\[data-poracode-thread-header\]::(before|after)$/);
    }
    const spinner = declarationsOf(
      'html[data-vc-shell] [data-poracode-thread-pane][data-vc-fx-state="tool"] > [data-poracode-thread-header] .poracode-thread-pane-title::after',
    );
    expect(spinner.get("position")).toBe("absolute");
    // Fills the title's trailing 8px flex gap, left of the actions.
    expect(spinner.get("right")).toBe("calc(-1 * var(--vc-space-3))");
    expect(spinner.get("animation")).toMatch(/^vc-fx-rotate /);
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
