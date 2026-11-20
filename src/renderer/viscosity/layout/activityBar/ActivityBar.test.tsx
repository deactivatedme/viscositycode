// ViscosityCode: what is left of the activity bar module (the sidebar state
// tracker and the main-sidebar marker) and the sidebar density rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Rule } from "postcss";
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { ActivitySidebarStateTracker } from "./ActivityBar";
import { isMainSidebarElement, markMainSidebarComponent } from "./activityBarHost";

function Shell() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="shell">
      <ActivitySidebarStateTracker shellRef={ref} />
    </div>
  );
}

beforeEach(() => {
  useSidebarOverlayStore.setState({
    isCollapsed: false,
    userCollapsed: false,
    isAutoCollapsed: false,
    isNarrow: false,
    closingOverlay: false,
  });
});

describe("ActivitySidebarStateTracker", () => {
  it("mirrors the collapsed and floating sidebar onto the shell root", () => {
    const view = render(<Shell />);
    const shell = view.getByTestId("shell");
    expect(shell).not.toHaveAttribute("data-vc-sidebar-collapsed");

    act(() => useSidebarOverlayStore.setState({ isCollapsed: true }));
    expect(shell).toHaveAttribute("data-vc-sidebar-collapsed");

    act(() => useSidebarOverlayStore.setState({ isCollapsed: false, isNarrow: true }));
    expect(shell).not.toHaveAttribute("data-vc-sidebar-collapsed");
    expect(shell).toHaveAttribute("data-vc-sidebar-overlay");

    view.unmount();
  });
});

describe("main sidebar marker", () => {
  it("recognises only elements of a marked component", () => {
    function MainSidebar() {
      return null;
    }
    function OverlaySidebar() {
      return null;
    }
    markMainSidebarComponent(MainSidebar);
    expect(isMainSidebarElement(<MainSidebar />)).toBe(true);
    expect(isMainSidebarElement(<OverlaySidebar />)).toBe(false);
    expect(isMainSidebarElement(<div />)).toBe(false);
    expect(isMainSidebarElement("text")).toBe(false);
    expect(isMainSidebarElement(null)).toBe(false);
  });
});

// jsdom does not apply CSS, so the sidebar density rules are checked on the
// stylesheet itself.
describe("sidebar stylesheet", () => {
  const css = readFileSync(
    join(process.cwd(), "src/renderer/viscosity/layout/activityBar.css"),
    "utf8",
  );

  function declarationsFor(selector: string): Map<string, string> {
    const out = new Map<string, string>();
    parse(css).walkRules((rule: Rule) => {
      if (!rule.selectors.some((s) => s.replace(/\s+/g, " ").trim() === selector)) return;
      rule.walkDecls((decl) => {
        out.set(decl.prop, decl.value);
      });
    });
    return out;
  }

  it("has no rail rules left", () => {
    expect(css).not.toContain(".vc-activitybar");
  });

  it("densifies only Chats-view thread rows, never the shared row class", () => {
    const row = declarationsFor(
      "html[data-vc-shell] .vc-sidebar-host-column [data-vc-sidebar-thread] .poracode-sidebar-thread-row",
    );
    expect(row.get("min-height")).toBe("var(--vc-row-height)");
    expect(row.get("border-radius")).toBe("var(--vc-radius-lg)");
    parse(css).walkRules((rule: Rule) => {
      for (const selector of rule.selectors) {
        if (!selector.includes("poracode-sidebar-thread-row")) continue;
        expect(selector).toMatch(/\.vc-sidebar-host-column \[data-vc-sidebar-thread\] /);
      }
    });
  });

  it("sets project names in the medium weight and muted colour", () => {
    const name = declarationsFor(
      "html[data-vc-shell] .vc-sidebar-host-column .poracode-sidebar-project-nudge .font-semibold",
    );
    expect(name.get("font-weight")).toBe("var(--vc-font-weight-medium)");
    expect(name.get("font-size")).toBe("var(--vc-font-size-sm)");
    expect(name.get("color")).toBe("var(--vc-text-muted)");
    // Keyboard focus restores the full text colour, same as hover.
    const lifted = declarationsFor(
      "html[data-vc-shell] .vc-sidebar-host-column .poracode-sidebar-project-nudge:is(:hover, :focus-visible) .font-semibold",
    );
    expect(lifted.get("color")).toBe("var(--vc-text)");
  });
});
