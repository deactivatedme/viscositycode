import { afterEach, describe, expect, it } from "vitest";
import { AGENT_PROFILE_DRIVERS } from "@/shared/contracts/agentProfiles";
import { AGENT_ACCENT_VAR, AGENT_KIND_ATTRIBUTE } from "./api";
import { assignDefaultAgentColors, type KnownAgentKind } from "./assignment";
import { agentColorCss } from "./palette";
import { buildAgentColorStylesheet, cssStringLiteral } from "./stylesheet";

const DRIVER = AGENT_PROFILE_DRIVERS[0]!.driver;
const PROFILE = `${DRIVER}:work`;

const installed = (...kinds: string[]): KnownAgentKind[] =>
  kinds.map((kind) => ({ kind, installed: true }));

/** The CSSOM drops insignificant whitespace in values; compare without it. */
const squash = (value: string) => value.replaceAll(/\s+/g, "");
const color = (id: Parameters<typeof agentColorCss>[0]) => squash(agentColorCss(id));

/** Parse `css` in a real <style> and return the accent `kind` would get (last matching rule wins). */
function accentFor(css: string, kind: string): string | undefined {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const element = document.createElement("div");
  element.setAttribute(AGENT_KIND_ATTRIBUTE, kind);
  let value: string | undefined;
  for (const rule of Array.from(style.sheet?.cssRules ?? [])) {
    if (!(rule instanceof CSSStyleRule)) continue;
    if (element.matches(rule.selectorText)) {
      value = squash(rule.style.getPropertyValue(AGENT_ACCENT_VAR));
    }
  }
  style.remove();
  return value;
}

function ruleCount(css: string): number {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const count = style.sheet?.cssRules.length ?? 0;
  style.remove();
  return count;
}

afterEach(() => {
  document.head.innerHTML = "";
});

describe("cssStringLiteral", () => {
  it("keeps ordinary kind characters", () => {
    expect(cssStringLiteral("agent-a")).toBe('"agent-a"');
    expect(cssStringLiteral(`${DRIVER}:work_1.2`)).toBe(`"${DRIVER}:work_1.2"`);
  });

  it("hex-escapes anything that could end the string or the sheet", () => {
    const literal = cssStringLiteral('a"]{}\\\n</style>');
    expect(literal).toBe('"a\\22 \\5d \\7b \\7d \\5c \\a \\3c \\2f style\\3e "');
    // Only the delimiting quotes remain unescaped.
    expect(literal.slice(1, -1)).not.toContain('"');
    expect(literal).not.toMatch(/[{}<>\n]/);
  });

  it("escapes astral characters as one code point", () => {
    expect(cssStringLiteral("🤖")).toBe('"\\1f916 "');
  });
});

describe("buildAgentColorStylesheet", () => {
  it("defines the accent for every known kind with its default colour", () => {
    const known = installed("agent-a", "agent-b");
    const defaults = assignDefaultAgentColors(known);
    const css = buildAgentColorStylesheet({ known, overrides: {} });
    expect(accentFor(css, "agent-a")).toBe(color(defaults["agent-a"]!));
    expect(accentFor(css, "agent-b")).toBe(color(defaults["agent-b"]!));
    expect(accentFor(css, "agent-unknown")).toBeUndefined();
  });

  it("is stable for the same input", () => {
    const known = installed("agent-b", "agent-a");
    expect(buildAgentColorStylesheet({ known, overrides: {} })).toBe(
      buildAgentColorStylesheet({ known: known.toReversed(), overrides: {} }),
    );
  });

  it("applies the owner's picks", () => {
    const css = buildAgentColorStylesheet({
      known: installed("agent-a"),
      overrides: { "agent-a": "pink", "agent-later": "teal" },
    });
    expect(accentFor(css, "agent-a")).toBe(color("pink"));
    // A pick for an agent not detected yet still applies.
    expect(accentFor(css, "agent-later")).toBe(color("teal"));
  });

  it("colours profile kinds like their driver, even ones not detected yet", () => {
    const known = installed(DRIVER, PROFILE);
    const driverColor = color(assignDefaultAgentColors(known)[DRIVER]!);
    const css = buildAgentColorStylesheet({ known, overrides: {} });
    expect(accentFor(css, DRIVER)).toBe(driverColor);
    expect(accentFor(css, PROFILE)).toBe(driverColor);
    expect(accentFor(css, `${DRIVER}:not-detected`)).toBe(driverColor);

    const picked = buildAgentColorStylesheet({ known, overrides: { [DRIVER]: "lime" } });
    expect(accentFor(picked, PROFILE)).toBe(color("lime"));
  });

  it("lets a profile's own pick win over its driver's colour", () => {
    const css = buildAgentColorStylesheet({
      known: installed(DRIVER, PROFILE),
      overrides: { [DRIVER]: "lime", [PROFILE]: "fuchsia" },
    });
    expect(accentFor(css, DRIVER)).toBe(color("lime"));
    expect(accentFor(css, PROFILE)).toBe(color("fuchsia"));
    expect(accentFor(css, `${DRIVER}:home`)).toBe(color("lime"));
  });

  it("keeps hostile kinds inside their own selector", () => {
    const hostile = 'x"] , * { --vc-agent-accent: red; } </style><script>alert(1)</script> [a="';
    const css = buildAgentColorStylesheet({
      known: installed(hostile, "agent-a"),
      overrides: {},
    });
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<script>");
    // A comment plus exactly one rule per kind.
    expect(ruleCount(css)).toBe(2);
    expect(accentFor(css, hostile)).toBeDefined();
    expect(accentFor(css, "agent-a")).not.toBe("red");
    expect(accentFor(css, "anything-else")).toBeUndefined();
  });

  it("emits only a header for no agents", () => {
    expect(ruleCount(buildAgentColorStylesheet({ known: [], overrides: {} }))).toBe(0);
  });
});
