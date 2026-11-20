// ViscosityCode: guards on the shared agent-activity stylesheet. jsdom does not
// apply CSS, so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AtRule, parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src/renderer/viscosity/agentActivity/agentActivity.css"),
  "utf8",
);
const root = parse(css);

function styleRules(): Rule[] {
  const found: Rule[] = [];
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (!(parent?.type === "atrule" && /keyframes$/.test((parent as AtRule).name))) {
      found.push(rule);
    }
  });
  return found;
}

function keyframeNames(): string[] {
  const names: string[] = [];
  root.walkAtRules(/keyframes$/, (atRule) => {
    names.push(atRule.params);
  });
  return names;
}

describe("agent-activity stylesheet", () => {
  it("scopes every rule to the desktop shell", () => {
    for (const rule of styleRules()) {
      for (const selector of rule.selectors) {
        expect(selector).toMatch(/^html\[data-vc-shell\]/);
      }
    }
  });

  it("keeps the dot pulse Mission Control and Roundtable depend on", () => {
    expect(keyframeNames()).toEqual(expect.arrayContaining(["vc-fx-dot-pulse", "vc-fx-rotate"]));
  });

  it("stops the tools spinner under reduced motion, Lightweight mode and in the background", () => {
    const stopped = styleRules().filter(
      (rule) =>
        rule.selector.includes(".vc-fx-spin") && /animation: none|paused/.test(rule.toString()),
    );
    const selectors = stopped.map((rule) => rule.selector);
    expect(selectors).toEqual(
      expect.arrayContaining([
        "html[data-vc-shell] .vc-fx-spin",
        "html[data-vc-shell][data-vc-lightweight] .vc-fx-spin",
        "html[data-vc-shell]:is([data-app-hidden], [data-app-unfocused]) .vc-fx-spin",
      ]),
    );
    const reduced = stopped.find(
      (rule) =>
        rule.parent?.type === "atrule" &&
        (rule.parent as AtRule).params.includes("prefers-reduced-motion"),
    );
    expect(reduced).toBeDefined();
  });
});
