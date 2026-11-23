// ViscosityCode: guards on newSession.css. jsdom does not apply CSS, so the
// rules and the upstream hooks they target are checked as source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("src/renderer/viscosity/newSession/newSession.css");

describe("new session stylesheet", () => {
  it("is imported by the module entry", () => {
    expect(read("src/renderer/viscosity/newSession/index.ts")).toContain(
      'import "./newSession.css";',
    );
  });

  it("scopes every rule to the shell's session draft", () => {
    let count = 0;
    parse(css).walkRules((rule) => {
      for (const selector of rule.selectors) {
        count += 1;
        expect(selector.startsWith("html[data-vc-shell] [data-vc-session]")).toBe(true);
      }
    });
    expect(count).toBeGreaterThan(0);
  });

  it("targets hooks that the upstream markup still renders", () => {
    const hooks: Array<[string, string]> = [
      ["src/renderer/components/thread/ThreadDraftView.tsx", 'data-draft-body=""'],
      ["src/renderer/components/thread/ThreadDraftView.tsx", 'data-draft-slack=""'],
      ["src/renderer/components/thread/ThreadDraftView.tsx", 'data-draft-composer-block=""'],
      ["src/renderer/components/thread/ThreadDraftView.tsx", 'data-draft-controls=""'],
      ["src/renderer/components/thread/ThreadDraftView.tsx", "data-vc-session={"],
      ["src/renderer/components/thread/ThreadDraftView.tsx", 'data-vc-session-center=""'],
      ["src/renderer/components/thread/ThreadDraftComposerArea.tsx", 'data-draft-worktree-row=""'],
    ];
    for (const [path, hook] of hooks) {
      expect(read(path), `${hook} in ${path}`).toContain(hook);
    }
    for (const attr of [
      "data-draft-body",
      "data-draft-slack",
      "data-draft-composer-block",
      "data-draft-controls",
      "data-draft-worktree-row",
      "data-vc-session-center",
    ]) {
      expect(css).toContain(`[${attr}]`);
    }
  });

  it("puts the project picker in the centre and keeps the composer at the bottom", () => {
    const orders = new Map<string, string>();
    parse(css).walkDecls("order", (decl) => {
      orders.set((decl.parent as { selector: string }).selector, decl.value);
    });
    const order = (hook: string) => [...orders].find(([selector]) => selector.endsWith(hook))?.[1];
    expect(order("[data-vc-session-center]")).toBe("0");
    expect(order("[data-draft-slack]")).toBe("1");
    expect(order("[data-draft-composer-block]")).toBe("2");
    expect(order("> [data-draft-worktree-row]")).toBe("3");
  });
});
