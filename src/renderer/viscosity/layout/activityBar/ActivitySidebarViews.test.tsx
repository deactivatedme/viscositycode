// ViscosityCode: the main sidebar's merged header row (view title + actions).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen } from "@testing-library/react";
import { parse } from "postcss";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { ActivitySidebarViews } from "./ActivitySidebarViews";
import { DEFAULT_ACTIVITY_VIEW_ID, useActivityViewStore } from "./activityViewPreference";

const env = vi.hoisted(() => ({ macChrome: false }));

vi.mock("@/renderer/components/layout/windowChrome", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/components/layout/windowChrome")>()),
  hasMacWindowChrome: () => env.macChrome,
}));
vi.mock("@/renderer/clientRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/clientRuntime")>()),
  isBrowserClientRuntime: () => false,
  hasAnyClientBridge: () => false,
  hasClientCapability: (name: string) => name === "localBackend" || name === "nativeAppUpdates",
}));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ channel: "stable", checkForUpdate: async () => undefined }),
}));
vi.mock("@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu", () => ({
  CreateProjectMenu: (props: { children: ReactNode }) => props.children,
}));
// The Explorer view body is not under test here.
vi.mock("./ExplorerSidebarView", () => ({ ExplorerSidebarView: () => null }));

/** The activityBar.css rule that hides upstream's Search and Browser header controls. */
function hiddenHeaderControlsSelector(): string {
  const css = readFileSync(
    join(process.cwd(), "src/renderer/viscosity/layout/activityBar.css"),
    "utf8",
  );
  let selector: string | null = null;
  parse(css).walkRules((rule) => {
    const hides = rule.nodes.some(
      (node) => node.type === "decl" && node.prop === "display" && node.value === "none",
    );
    if (hides && rule.selector.includes(".vc-sidebar-view-actions")) selector = rule.selector;
  });
  if (!selector) throw new Error("hide rule not found");
  return selector;
}

function header(): HTMLElement {
  const row = document.querySelector<HTMLElement>(".vc-sidebar-view-header");
  if (!row) throw new Error("header row not rendered");
  return row;
}

const originalOpenHome = useAppStore.getState().openHome;

beforeEach(() => {
  env.macChrome = false;
  useActivityViewStore.setState({ requestedViewId: DEFAULT_ACTIVITY_VIEW_ID });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});

afterEach(() => {
  useAppStore.setState({ openHome: originalOpenHome });
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("ActivitySidebarViews header", () => {
  it("puts the view title and the sidebar actions in one row", () => {
    render(<ActivitySidebarViews visible collapsed={false} />);
    const row = header();

    expect(row.querySelector("h2")).toHaveTextContent("Agents");
    // Upstream's header controls, minus nothing in the DOM: CSS drops the
    // two the activity bar provides (below).
    for (const name of [/ViscosityCode/, /Add project/, /List options/, /Terminal/]) {
      expect(row.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(row.contains(screen.getByRole("button", { name: "Check for updates" }))).toBe(true);
    // Title first, actions last, no separate row above or below.
    expect(row.firstElementChild?.tagName).toBe("H2");
    expect(row.lastElementChild).toHaveClass("vc-sidebar-view-actions");
    expect(document.querySelectorAll(".vc-sidebar-view-header")).toHaveLength(1);
  });

  it("hides exactly the Search and Browser controls the activity bar already provides", () => {
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    render(<ActivitySidebarViews visible collapsed={false} />);

    const hidden = [...document.querySelectorAll(hiddenHeaderControlsSelector())];
    const hiddenLabels = hidden
      .map((element) => element.querySelector("button")?.getAttribute("aria-label"))
      .sort();
    expect(hiddenLabels).toEqual(["Open browser", "Search"]);
    // Everything else in the row stays.
    for (const name of [/ViscosityCode/, /Add project/, /List options/, /Terminal/]) {
      const button = screen.getByRole("button", { name });
      expect(hidden.some((element) => element.contains(button))).toBe(false);
    }
  });

  it("goes home from the Home action", () => {
    const openHome = vi.fn<() => void>();
    useAppStore.setState({ openHome });
    render(<ActivitySidebarViews visible collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /ViscosityCode/ }));
    expect(openHome).toHaveBeenCalledTimes(1);
  });

  it("titles a registry view and keeps the actions beside it", () => {
    useActivityViewStore.setState({ requestedViewId: "explorer" });
    render(<ActivitySidebarViews visible collapsed={false} />);
    const row = header();
    expect(row.querySelector("h2")).toHaveTextContent("Explorer");
    expect(row.contains(screen.getByRole("button", { name: "Terminal" }))).toBe(true);
  });

  it("reserves the macOS traffic-light gutter before the title", () => {
    env.macChrome = true;
    render(<ActivitySidebarViews visible collapsed={false} />);
    const first = header().firstElementChild;
    expect(first).toHaveClass("vc-traffic-light-gutter");
    expect(first?.nextElementSibling?.tagName).toBe("H2");
  });
});
