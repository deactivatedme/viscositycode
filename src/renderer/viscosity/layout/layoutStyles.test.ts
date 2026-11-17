// ViscosityCode: guards on the fork shell stylesheets (activity bar, sidebar
// header, status bar). jsdom does not apply CSS, so the rules themselves are
// checked here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const LAYOUT_DIR = join(process.cwd(), "src/renderer/viscosity/layout");
const sheets = {
  activityBar: readFileSync(join(LAYOUT_DIR, "activityBar.css"), "utf8"),
  shell: readFileSync(join(LAYOUT_DIR, "shell.css"), "utf8"),
};

function rules(css: string): Rule[] {
  const found: Rule[] = [];
  parse(css).walkRules((rule) => {
    found.push(rule);
  });
  return found;
}

function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) => selector.replace(/\s+/g, " ").trim());
}

/** Declarations of every rule whose selector list contains `selector`. */
function declarationsFor(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules(css)) {
    if (!selectorsOf(rule).includes(selector)) continue;
    rule.walkDecls((decl: Declaration) => {
      out.set(decl.prop, decl.value);
    });
  }
  return out;
}

describe("fork shell stylesheets", () => {
  it("scope every rule to html[data-vc-shell], leaving compact/PWA and the extension untouched", () => {
    for (const [name, css] of Object.entries(sheets)) {
      for (const rule of rules(css)) {
        for (const selector of selectorsOf(rule)) {
          expect([name, selector]).toEqual([name, expect.stringMatching(/^html\[data-vc-shell\]/)]);
        }
      }
    }
  });

  it("gives every status bar item the bar's one type size, line box and muted colour", () => {
    const bar = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-statusbar");
    expect(bar.get("font-size")).toBe("var(--vc-font-size-xs)");
    expect(bar.get("line-height")).toBe("var(--vc-statusbar-line-height)");
    expect(bar.get("color")).toBe("var(--vc-text-muted)");

    // Any element an item renders (HeroUI buttons, spans, registered items).
    const descendants = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-statusbar *");
    expect(descendants.get("font-size")).toBe("inherit");
    expect(descendants.get("line-height")).toBe("inherit");

    const item = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-statusbar__item");
    expect(item.get("font-size")).toBe("var(--vc-font-size-xs)");
    expect(item.get("line-height")).toBe("var(--vc-statusbar-line-height)");
    expect(item.get("color")).toBe("inherit");
  });

  it("makes the bar opaque under native material only while the floating sidebar is mounted", () => {
    const tinted = declarationsFor(
      sheets.activityBar,
      'html[data-vc-shell][data-native-material="on"] .poracode-shell[data-vc-activitybar][data-vc-sidebar-overlay] > .vc-activitybar',
    );
    expect(tinted.get("background")).toBe("var(--vc-panel-bg)");
    const glass = declarationsFor(
      sheets.activityBar,
      'html[data-vc-shell][data-native-material="on"] .vc-activitybar',
    );
    expect(glass.get("background")).toBe("transparent");
    // A translucent chrome without native material turns opaque too.
    const opaque = declarationsFor(
      sheets.activityBar,
      "html[data-vc-shell] .poracode-shell[data-vc-activitybar][data-vc-sidebar-overlay] > .vc-activitybar",
    );
    expect(opaque.get("background")).toBe("var(--vc-chrome-bg)");
  });

  it("lays the sidebar's merged header out as one draggable row with compact actions", () => {
    const row = declarationsFor(sheets.activityBar, "html[data-vc-shell] .vc-sidebar-view-header");
    expect(row.get("height")).toBe("var(--vc-sidebar-view-header-height)");
    expect(row.get("app-region")).toBe("drag");
    const actions = declarationsFor(
      sheets.activityBar,
      "html[data-vc-shell] .vc-sidebar-view-actions button",
    );
    expect(actions.get("width")).toBe("var(--vc-sidebar-action-size)");
    expect(actions.get("height")).toBe("var(--vc-sidebar-action-size)");
    const overlayRow = declarationsFor(
      sheets.activityBar,
      "html[data-vc-shell] .poracode-sidebar-aside--overlay .vc-sidebar-view-header",
    );
    expect(overlayRow.get("app-region")).toBe("no-drag");
  });
});
