// ViscosityCode: guards on the shell's content-surface stylesheet (content.css).
// jsdom does not apply CSS, so the rules and the upstream hooks they target are
// checked as source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const css = read("src/renderer/viscosity/layout/content.css");

function rules(): Rule[] {
  const found: Rule[] = [];
  parse(css).walkRules((rule) => {
    found.push(rule);
  });
  return found;
}

function declarationsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules()) {
    if (!rule.selectors.map((s) => s.replace(/\s+/g, " ").trim()).includes(selector)) continue;
    rule.walkDecls((decl) => {
      out.set(decl.prop, decl.value);
    });
  }
  return out;
}

describe("shell content stylesheet", () => {
  it("is imported by the shell layout entry", () => {
    expect(read("src/renderer/viscosity/layout/layout.css")).toContain('@import "./content.css";');
  });

  it("scopes every rule to html[data-vc-shell]", () => {
    const selectors = rules().flatMap((rule) => rule.selectors);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toMatch(/^html\[data-vc-shell\]/);
    }
  });

  it("adds no effects, motion or !important overrides", () => {
    parse(css).walkDecls((decl) => {
      expect(decl.important ?? false).toBe(false);
      expect(decl.prop).not.toMatch(
        /^(transition|animation|scroll-behavior|box-shadow|filter|backdrop-filter)/,
      );
    });
  });

  it("narrows only GUI thread panes to the shell's chat column", () => {
    expect(declarationsFor("html[data-vc-shell]").get("--poracode-chat-column-max")).toBe(
      "var(--vc-chat-column-max)",
    );
    const body = declarationsFor(
      "html[data-vc-shell] .m-thread:not(.m-thread--terminal) > .m-thread-content > div",
    );
    expect(body.get("max-width")).toBe("var(--poracode-chat-column-max)");
    const header = declarationsFor(
      "html[data-vc-shell] .m-thread:not(.m-thread--terminal) > [data-poracode-thread-header] > :is(.poracode-content-over-drag-region, .poracode-content-over-drag-region--drag)",
    );
    expect(header.get("max-width")).toBe("var(--poracode-chat-column-max)");
  });

  it("styles prompts, tool labels, draft headlines and Settings rows from tokens", () => {
    const prompt = declarationsFor("html[data-vc-shell] .poracode-chat-prompt-surface");
    expect(prompt.get("border-radius")).toBe("var(--vc-prompt-radius)");
    expect(prompt.get("background")).toBe("var(--vc-surface-raised)");

    const label = declarationsFor("html[data-vc-shell] .poracode-tool-section-label");
    expect(label.get("font-size")).toBe("var(--vc-font-size-xs)");
    expect(label.get("text-transform")).toBe("none");

    const strip = declarationsFor(
      "html[data-vc-shell] .poracode-chat-prompt-surface .poracode-message-action-strip",
    );
    expect(strip.get("border-radius")).toBe("var(--vc-radius-md)");
    expect(strip.get("background")).toBe("var(--vc-surface-raised)");

    const headline = declarationsFor("html[data-vc-shell] .poracode-draft-headline");
    expect(headline.get("font-size")).toBe("var(--vc-font-size-lg)");
    expect(headline.get("font-weight")).toBe("var(--vc-font-weight-medium)");
    expect(headline.get("color")).toBe("var(--vc-text-muted)");

    // The split-draft hero is screen-reader only, not demoted.
    const hero = declarationsFor("html[data-vc-shell] [data-draft-hero] h1");
    expect(hero.get("position")).toBe("absolute");
    expect(hero.get("clip")).toBe("rect(0, 0, 0, 0)");
    expect(hero.get("overflow")).toBe("hidden");
    expect(hero.has("display")).toBe(false);

    const nav = declarationsFor("html[data-vc-shell] .poracode-settings-nav-row");
    expect(nav.get("min-height")).toBe("var(--vc-control-height)");
    expect(nav.get("border-radius")).toBe("var(--vc-radius-md)");
    // Outline/focus ring stays upstream's.
    expect(nav.has("outline")).toBe(false);
  });

  it("targets hooks that the upstream markup still renders", () => {
    const hooks: Array<[string, string]> = [
      [
        "src/renderer/components/thread/ChatPane/parts/items/chatMessageSurface.ts",
        "poracode-chat-prompt-surface",
      ],
      [
        "src/renderer/components/thread/ChatPane/parts/items/UserMessage.tsx",
        "poracode-message-action-strip",
      ],
      [
        "src/renderer/components/thread/ChatPane/parts/items/ToolCallSections.tsx",
        "poracode-tool-section-label",
      ],
      ["src/renderer/components/thread/ThreadDraftView.tsx", "poracode-draft-headline"],
      ["src/renderer/components/thread/ThreadDraftChrome.tsx", 'data-draft-hero=""'],
      ["src/renderer/views/SettingsOverlay/parts/SettingsSidebar.tsx", "poracode-settings-nav-row"],
      ["src/renderer/components/thread/ThreadView.tsx", "m-thread m-thread--terminal"],
      ["src/renderer/components/thread/ThreadView.tsx", "`m-thread-content "],
      ["src/renderer/components/thread/ThreadView.tsx", 'data-poracode-thread-header=""'],
      [
        "src/renderer/components/thread/ThreadView.tsx",
        '"poracode-content-over-drag-region" : "poracode-content-over-drag-region--drag"',
      ],
    ];
    for (const [path, hook] of hooks) {
      expect([path, read(path).includes(hook)]).toEqual([path, true]);
    }
  });
});
