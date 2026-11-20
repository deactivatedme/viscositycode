// ViscosityCode: guards on the shell density tokens in tokens.css. jsdom does
// not apply CSS, so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = parse(
  readFileSync(join(process.cwd(), "src/renderer/theme/viscosity/tokens.css"), "utf8"),
);

/** Top-level (unlayered, outside @media) rules, in source order. */
const topRules = css.nodes.filter((node): node is Rule => node.type === "rule");

function decls(rule: Rule): Map<string, string> {
  const found = new Map<string, string>();
  rule.walkDecls((decl) => {
    found.set(decl.prop, decl.value.replace(/\s+/g, " "));
  });
  return found;
}

function topRule(selector: string): Rule {
  const rule = topRules.find((candidate) => candidate.selector === selector);
  if (!rule) throw new Error(`missing ${selector}`);
  return rule;
}

const NEW_TOKENS = [
  "--vc-line-height-ui",
  "--vc-line-height-meta",
  "--vc-font-weight-regular",
  "--vc-font-weight-medium",
  "--vc-control-height",
  "--vc-control-height-sm",
  "--vc-row-height",
  "--vc-prompt-radius",
  "--vc-composer-radius",
  "--vc-chat-column-max",
  "--vc-surface-raised",
];

const root = decls(topRule(":root"));
const shell = decls(topRule("html[data-vc-shell]"));

describe("shell density tokens", () => {
  it("defines the new token names for every window", () => {
    expect(Object.fromEntries([...root].filter(([prop]) => NEW_TOKENS.includes(prop)))).toEqual({
      "--vc-line-height-ui": "18px",
      "--vc-line-height-meta": "16px",
      "--vc-font-weight-regular": "400",
      "--vc-font-weight-medium": "500",
      "--vc-control-height": "28px",
      "--vc-control-height-sm": "24px",
      "--vc-row-height": "26px",
      "--vc-prompt-radius": "var(--vc-radius-lg)",
      "--vc-composer-radius": "10px",
      "--vc-chat-column-max": "768px",
      "--vc-surface-raised": "color-mix(in oklab, var(--foreground) 3%, var(--vc-panel-bg))",
    });
  });

  it("tightens metrics and motion only inside the fork shell", () => {
    expect(Object.fromEntries(shell)).toEqual({
      "--vc-activitybar-width": "0px",
      "--vc-statusbar-height": "22px",
      "--vc-tabstrip-height": "32px",
      "--vc-row-height": "30px",
      "--vc-composer-radius": "16px",
      "--vc-prompt-radius": "var(--vc-radius-xl)",
      "--vc-motion-base": "160ms",
      "--vc-motion-slow": "240ms",
      "--vc-motion-enter": "140ms",
      "--vc-motion-enter-sm": "100ms",
      "--vc-hover": "color-mix(in oklab, var(--foreground) 5%, transparent)",
    });
    // Compact, PWA and extension windows keep the released values.
    expect(root.get("--vc-activitybar-width")).toBe("48px");
    expect(root.get("--vc-statusbar-height")).toBe("24px");
    expect(root.get("--vc-tabstrip-height")).toBe("35px");
    expect(root.get("--vc-motion-base")).toBe("200ms");
    expect(root.get("--vc-hover")).toBe("color-mix(in oklab, var(--foreground) 6%, transparent)");
    // The active fill stays visible on #000 and white.
    expect(root.get("--vc-active")).toBe("color-mix(in oklab, var(--foreground) 10%, transparent)");
    expect(shell.has("--vc-active")).toBe(false);
  });

  it("drops the fx motion switches (Effects is gone)", () => {
    expect(topRules.some((rule) => rule.selector.includes("data-vc-motion"))).toBe(false);
  });

  it("zeroes every shell duration under reduced motion", () => {
    let reduced: Rule | undefined;
    let mediaIndex = -1;
    css.walkAtRules("media", (atRule: AtRule) => {
      if (atRule.params.includes("prefers-reduced-motion: reduce")) {
        reduced = atRule.nodes?.find((node): node is Rule => node.type === "rule");
        mediaIndex = css.nodes.indexOf(atRule);
      }
    });
    expect(reduced?.selectors).toContain("html[data-vc-shell]");
    // Same specificity as html[data-vc-shell], so the media block must come after it.
    expect(mediaIndex).toBeGreaterThan(css.nodes.indexOf(topRule("html[data-vc-shell]")));
    const zeroed = decls(reduced!);
    const shellMotion = [...shell.keys()].filter((prop) => prop.startsWith("--vc-motion-"));
    expect(shellMotion.filter((prop) => zeroed.get(prop) !== "0ms")).toEqual([]);
  });
});

describe("warm shell palette", () => {
  function layered(selector: string): Map<string, string> {
    let found: Rule | undefined;
    css.walkAtRules("layer", (layer: AtRule) => {
      found ??= layer.nodes?.find(
        (node): node is Rule => node.type === "rule" && node.selector === selector,
      );
    });
    if (!found) throw new Error(`missing layered ${selector}`);
    return decls(found);
  }

  it("scopes the warm greys to the base theme inside the desktop shell", () => {
    expect(
      Object.fromEntries(
        [...layered('html[data-vc-shell].dark[data-theme-preset="default"]')].filter(([prop]) =>
          [
            "--sidebar-background",
            "--background",
            "--content-background",
            "--surface",
            "--composer-surface",
            "--border",
            "--foreground",
            "--muted",
            "--field-placeholder",
            "--accent",
            "--accent-foreground",
          ].includes(prop),
        ),
      ),
    ).toEqual({
      "--sidebar-background": "#1a1918",
      "--background": "#1e1d1b",
      "--content-background": "#232220",
      "--surface": "#2a2926",
      "--composer-surface": "#2d2c29",
      "--border": "#393834",
      "--foreground": "#ecebe6",
      "--muted": "#a19f97",
      "--field-placeholder": "#8d8b84",
      "--accent": "#ecebe6",
      "--accent-foreground": "#1e1d1b",
    });
    const light = layered('html[data-vc-shell].light[data-theme-preset="default"]');
    expect(light.get("--sidebar-background")).toBe("#efeee8");
    expect(light.get("--background")).toBe("#f5f4ef");
    expect(light.get("--content-background")).toBe("#faf9f5");
    expect(light.get("--surface")).toBe("#ffffff");
    expect(light.get("--composer-surface")).toBe("#ffffff");
    expect(light.get("--border")).toBe("#e2e0d8");
    expect(light.get("--foreground")).toBe("#1f1e1c");
    expect(light.get("--muted")).toBe("#6b6961");
    expect(light.get("--accent")).toBe("#1f1e1c");
    expect(light.get("--accent-foreground")).toBe("#ffffff");
  });
});
