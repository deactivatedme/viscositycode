// ViscosityCode: guards on the Zen mode stylesheet. jsdom does not apply CSS,
// so the rules themselves are checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AtRule, type Declaration, parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/renderer/viscosity/zen/zen.css"), "utf8");
const entry = readFileSync(join(process.cwd(), "src/renderer/viscosity/viscosity.css"), "utf8");

function rules(): Rule[] {
  const found: Rule[] = [];
  parse(css).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as AtRule).name)) return;
    found.push(rule);
  });
  return found;
}

function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) => selector.replace(/\s+/g, " ").trim());
}

function declarationsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules()) {
    if (!selectorsOf(rule).includes(selector)) continue;
    rule.walkDecls((decl: Declaration) => {
      out.set(decl.prop, decl.value);
    });
  }
  return out;
}

/** Selectors (normalised) of every rule that sets `prop: value`. */
function selectorsSetting(prop: string, value: string): string[] {
  return rules().flatMap((rule) => {
    let sets = false;
    rule.walkDecls((decl) => {
      if (decl.prop === prop && decl.value === value) sets = true;
    });
    return sets ? selectorsOf(rule) : [];
  });
}

const ZEN = "html[data-vc-shell][data-vc-zen]";
const SHELL = `${ZEN} .poracode-shell[data-vc-activitybar]`;

describe("Zen mode stylesheet", () => {
  it("is loaded by the fork stylesheet entry", () => {
    expect(entry).toContain('@import "./zen/zen.css";');
  });

  it("scopes every rule to html[data-vc-shell][data-vc-zen], leaving compact/PWA untouched", () => {
    for (const rule of rules()) {
      for (const selector of selectorsOf(rule)) {
        const rootCompound = selector.split(" ")[0] ?? "";
        expect(rootCompound).toMatch(/^html\[data-vc-shell\]/);
        expect(rootCompound).toContain("[data-vc-zen]");
      }
    }
  });

  it("removes the status bar, the sidebar's handle and backdrop, the content header and the right/git panels", () => {
    const hidden = selectorsSetting("display", "none");
    expect(hidden).toEqual(
      expect.arrayContaining([
        `${ZEN} .vc-statusbar`,
        `${SHELL} .poracode-sidebar-spacer`,
        `${SHELL} [data-vc-sidebar-handle]`,
        `${SHELL} [data-vc-sidebar-backdrop]`,
        `${SHELL} [data-vc-content-header]`,
        // Right panel (side or bottom) and git panel, their resize handles and
        // the backdrop of a floating right/git panel.
        `${SHELL} [data-vc-panel-slot]`,
        `${SHELL} [data-vc-panel-handle]`,
        `${SHELL} [data-vc-panel-backdrop]`,
      ]),
    );
  });

  it("finds the shell's chrome through stable hooks, never DOM position or Tailwind classes", () => {
    for (const rule of rules()) {
      for (const selector of selectorsOf(rule)) {
        // A child step must name a hook, not an element type or "whatever is there".
        expect(selector).not.toMatch(/>\s*(?:div|aside|main|section|\*|:is|:where)\b/);
        expect(selector).not.toMatch(
          /:(?:nth-child|nth-of-type|nth-last-child|first-child|last-child|only-child)\b/,
        );
        // Tailwind utilities (fork classes are vc-*, upstream hooks poracode-*).
        expect(selector).not.toMatch(
          /\.(?:flex|grid|block|hidden|absolute|relative|fixed|sticky|shrink|grow|inset|border|bg-|h-|w-|z-|min-|max-|p[xytrbl]?-|m[xytrbl]?-)/,
        );
      }
    }
  });

  it("hides the sidebar without collapsing the width AppShell measures", () => {
    // AppShell measures it (the sidebar's ResizeObserver) to decide when the
    // sidebar and right/git panels float; display: none would read 0 px and
    // leaving zen would re-dock or dismiss them.
    for (const selector of selectorsSetting("display", "none")) {
      expect(selector).not.toMatch(/\.poracode-sidebar-aside\b/);
    }
    // The vertical rail is gone; nothing targets it any more.
    for (const rule of rules()) {
      for (const selector of selectorsOf(rule)) expect(selector).not.toMatch(/\.vc-activitybar\b/);
    }
    const hidden = declarationsFor(`${SHELL} .poracode-sidebar-aside`);
    expect(hidden.get("position")).toBe("fixed");
    expect(hidden.get("visibility")).toBe("hidden");
    expect(hidden.get("pointer-events")).toBe("none");
    for (const sizing of ["display", "width", "min-width", "max-width", "flex", "flex-basis"]) {
      expect(hidden.has(sizing)).toBe(false);
    }
    // Nothing else in zen mode resizes it either.
    for (const rule of rules()) {
      const targetsChrome = selectorsOf(rule).some((selector) =>
        /\.poracode-sidebar-aside$/.test(selector),
      );
      if (!targetsChrome) continue;
      rule.walkDecls((decl) => {
        expect(["width", "min-width", "max-width", "display"]).not.toContain(decl.prop);
      });
    }
  });

  it("keeps the revealed tab strip's trailing controls clear of the Exit Zen pill", () => {
    const strip = declarationsFor(`${ZEN} [data-vc-center] > .vc-tabstrip`);
    expect(strip.get("padding-right")).toBe("var(--vc-zen-pill-reserve)");
    const root = declarationsFor(ZEN);
    const reserve = root.get("--vc-zen-pill-reserve") ?? "";
    expect(reserve).toContain("var(--vc-zen-pill-right)");
    expect(reserve).toMatch(/var\(--vc-zen-pill-width, [^)]+\)/);
    const pill = declarationsFor(`${ZEN} .vc-zen-exit`);
    expect(pill.get("right")).toBe("var(--vc-zen-pill-right)");
  });

  it("parks the tab strip hidden in the top band and fades it in on reveal", () => {
    const strip = declarationsFor(
      "html[data-vc-shell][data-vc-zen] [data-vc-center] > .vc-tabstrip",
    );
    expect(strip.get("position")).toBe("absolute");
    expect(strip.get("visibility")).toBe("hidden");
    expect(strip.get("opacity")).toBe("0");

    const revealed = declarationsFor(
      "html[data-vc-shell][data-vc-zen][data-vc-zen-reveal] [data-vc-center] > .vc-tabstrip",
    );
    expect(revealed.get("visibility")).toBe("visible");
    expect(revealed.get("opacity")).toBe("1");
  });

  it("centres the focused pane at a comfortable width", () => {
    const body = declarationsFor(
      "html[data-vc-shell][data-vc-zen] [data-vc-center] > [data-vc-center-body]",
    );
    expect(body.get("width")).toBe("min(100%, var(--vc-zen-content-width))");
    expect(body.get("margin-inline")).toBe("auto");

    const others = declarationsFor(
      "html[data-vc-shell][data-vc-zen] [data-vc-zen-split] > :not([data-vc-zen-pane])",
    );
    expect(others.get("visibility")).toBe("hidden");
    expect(others.get("pointer-events")).toBe("none");
  });

  it("removes the reveal band while the strip shows, so the strip keeps its window-drag region", () => {
    const band = declarationsFor(
      "html[data-vc-shell][data-vc-zen][data-vc-zen-reveal] .vc-zen-hotzone",
    );
    expect(band.get("display")).toBe("none");
  });

  it("keeps the pill clickable inside the window-drag band", () => {
    const pill = declarationsFor("html[data-vc-shell][data-vc-zen] .vc-zen-exit");
    expect(pill.get("position")).toBe("fixed");
    expect(pill.get("app-region")).toBe("no-drag");
    expect(pill.get("-webkit-app-region")).toBe("no-drag");
  });

  it("uses fork tokens instead of literal colours", () => {
    parse(css).walkDecls((decl) => {
      expect([decl.prop, decl.value]).not.toEqual([
        decl.prop,
        expect.stringMatching(/#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(/i),
      ]);
    });
  });
});
