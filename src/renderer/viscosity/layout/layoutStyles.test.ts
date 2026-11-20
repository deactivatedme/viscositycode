// ViscosityCode: guards on the fork shell stylesheets (sidebar header, nav
// list, status bar, top bar, composer, palette). jsdom does not apply CSS, so the rules themselves are
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

  it("lays the sidebar's merged header out as one draggable row with compact actions", () => {
    const row = declarationsFor(sheets.activityBar, "html[data-vc-shell] .vc-sidebar-view-header");
    expect(row.get("height")).toBe("var(--vc-sidebar-view-header-height)");
    expect(row.get("app-region")).toBe("drag");
    const actions = declarationsFor(
      sheets.activityBar,
      "html[data-vc-shell] .vc-sidebar-projects__actions button",
    );
    expect(actions.get("width")).toBe("var(--vc-sidebar-action-size)");
    expect(actions.get("height")).toBe("var(--vc-sidebar-action-size)");
    const overlayRow = declarationsFor(
      sheets.activityBar,
      "html[data-vc-shell] .poracode-sidebar-aside--overlay .vc-sidebar-view-header",
    );
    expect(overlayRow.get("app-region")).toBe("no-drag");
  });

  it("lays nav rows out 30px tall, 2px apart, with a raised New row", () => {
    const nav = declarationsFor(sheets.activityBar, "html[data-vc-shell] .vc-sidebar-nav");
    expect(nav.get("gap")).toBe("2px");
    const row = declarationsFor(sheets.activityBar, "html[data-vc-shell] .vc-sidebar-nav__row");
    expect(row.get("height")).toBe("var(--vc-row-height)");
    const fresh = declarationsFor(
      sheets.activityBar,
      "html[data-vc-shell] .vc-sidebar-nav__row--new",
    );
    expect(fresh.get("background")).toBe("var(--vc-surface-raised)");
    const host = declarationsFor(sheets.activityBar, "html[data-vc-shell] .vc-sidebar-host-column");
    expect(host.get("padding-inline")).toBe("var(--vc-sidebar-padding-inline)");
    expect(
      declarationsFor(sheets.activityBar, "html[data-vc-shell]").get("--vc-sidebar-padding-inline"),
    ).toBe("10px");
  });

  it("keeps the sidebar chrome cheap: no blur, no animation, no !important, no caps", () => {
    parse(sheets.activityBar).walkDecls((decl) => {
      expect([decl.prop, Boolean(decl.important)]).toEqual([decl.prop, false]);
      expect(decl.prop).not.toMatch(/^(animation|backdrop-filter|-webkit-backdrop-filter|filter)$/);
      expect([decl.prop, decl.value]).not.toEqual(["text-transform", "uppercase"]);
    });
  });

  it("hides the pane title in a single pane, where the top bar shows it", () => {
    const title = declarationsFor(
      sheets.shell,
      "html[data-vc-shell] [data-vc-center][data-vc-single-pane] .poracode-thread-pane-title",
    );
    expect(title.get("visibility")).toBe("hidden");
    expect(sheets.shell).not.toContain(".vc-tabstrip__scroller");
    const barTitle = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-topbar__title");
    expect(barTitle.get("text-overflow")).toBe("ellipsis");
  });

  it("draws tabs as flat inset rects with a neutral active fill and a visible focus ring", () => {
    const tab = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-tab");
    expect(tab.has("border-right")).toBe(false);
    expect(tab.get("border-radius")).toBe("var(--vc-radius-md)");
    const selected = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-tab[data-selected]");
    expect(selected.get("background")).toBe("var(--vc-active)");
    expect(selected.get("box-shadow")).not.toContain("--vc-accent");
    const focus = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-tab__main:focus-visible");
    expect(focus.get("box-shadow")).toContain("var(--vc-focus-ring)");
    const pane = declarationsFor(sheets.shell, "html[data-vc-shell]");
    expect(pane.get("--vc-pane-header-height")).toBe("26px");
  });

  it("thickens split dividers neutrally on hover but keeps a focus-ring colour for the keyboard", () => {
    const hover = declarationsFor(
      sheets.shell,
      "html[data-vc-shell] .poracode-pane-divider:is(:hover, :active)::after",
    );
    expect(hover.get("background")).toBe("var(--vc-border)");
    const focus = declarationsFor(
      sheets.shell,
      "html[data-vc-shell] .poracode-pane-divider:focus-visible::after",
    );
    expect(focus.get("background")).toBe("var(--vc-focus-ring)");
  });

  it("shows composer focus as a border-colour change only, with no !important halo or draft glow", () => {
    const composerRules = rules(sheets.shell).filter((rule) =>
      rule.selector.includes("poracode-composer"),
    );
    expect(composerRules.length).toBeGreaterThan(0);
    for (const rule of composerRules) {
      rule.walkDecls((decl) => {
        expect([rule.selector, decl.prop, Boolean(decl.important)]).toEqual([
          rule.selector,
          decl.prop,
          false,
        ]);
      });
    }
    const focusRules = rules(sheets.shell).filter((rule) =>
      selectorsOf(rule).some((selector) =>
        selector.includes(".poracode-composer-shell:focus-within"),
      ),
    );
    expect(focusRules).toHaveLength(1);
    expect(
      focusRules[0]!.nodes.flatMap((node) => (node.type === "decl" ? [node.prop] : [])),
    ).toEqual(["border-color"]);
    const glow = declarationsFor(
      sheets.shell,
      "html[data-vc-shell] .poracode-composer-border-glow",
    );
    expect(glow.get("display")).toBe("none");
  });

  it("draws the composer as a 16px card with ghost pickers and a 28px accent send circle", () => {
    const card = declarationsFor(sheets.shell, "html[data-vc-shell] .poracode-composer-shell");
    expect(card.get("border-radius")).toBe("var(--vc-composer-radius)");
    expect(card.get("border")).toBe("1px solid var(--vc-border)");
    expect(card.get("background")).toBe("var(--composer-surface)");
    const send = declarationsFor(
      sheets.shell,
      "html[data-vc-shell] .poracode-composer-toolbar .poracode-composer-send",
    );
    expect(send.get("width")).toBe("var(--vc-control-height)");
    expect(send.get("height")).toBe("var(--vc-control-height)");
    expect(send.get("border-radius")).toBe("var(--vc-radius-pill)");
    expect(send.get("background")).toBe("var(--vc-accent)");
    const controls = rules(sheets.shell).find((rule) =>
      rule.selector.includes(".poracode-composer-toggle"),
    );
    const decls = new Map<string, string>();
    controls?.walkDecls((decl) => {
      decls.set(decl.prop, decl.value);
    });
    expect(decls.get("height")).toBe("var(--vc-control-height)");
    expect(decls.get("border-radius")).toBe("var(--vc-radius-md)");
    expect(decls.get("background")).toBe("transparent");
    expect(decls.get("border")).toBe("0");
    expect(decls.get("color")).toBe("var(--vc-text-muted)");
  });

  it("gives palette rows control height that still grows for subtitles", () => {
    const row = declarationsFor(
      sheets.shell,
      'html[data-vc-shell] [data-vc-palette] [role="listbox"] [role="option"]',
    );
    expect(row.get("min-height")).toBe("var(--vc-control-height)");
    expect(row.get("height")).toBe("auto");
    const hint = declarationsFor(
      sheets.shell,
      'html[data-vc-shell] [data-vc-palette] [role="listbox"] [role="option"] > span:nth-child(3)',
    );
    expect(hint.get("font-size")).toBe("var(--vc-font-size-xs)");
    const palette = declarationsFor(sheets.shell, "html[data-vc-shell] [data-vc-palette]");
    expect(palette.get("box-shadow")).toBe("var(--vc-shadow-lg)");
  });

  it("leaves the status bar height to the shell token", () => {
    const bar = declarationsFor(sheets.shell, "html[data-vc-shell] .vc-statusbar");
    expect(bar.has("height")).toBe(false);
  });

  it("times every shell transition with --vc-motion-* tokens so motion-off and reduced motion zero them", () => {
    const offenders: string[] = [];
    parse(sheets.shell).walkDecls(/^transition/, (decl) => {
      for (const part of decl.value.split(",")) {
        if (!/var\(--vc-motion-[a-z-]+\)/.test(part)) offenders.push(decl.toString());
      }
    });
    expect(offenders).toEqual([]);
  });
});
