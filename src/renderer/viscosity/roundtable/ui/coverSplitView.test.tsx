import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import { coverSplitView, useCoverSplitView } from "./coverSplitView";
import { RoundtableCenterHost } from "./RoundtableCenterHost";
import { useRoundtableViewStore } from "./roundtableViewStore";

vi.mock("./RoundtableView", () => ({
  RoundtableView: (props: { sessionId: string }) => (
    <section aria-label={`Roundtable ${props.sessionId}`}>
      <button type="button">Close Roundtable</button>
    </section>
  ),
}));

/** `[data-vc-center-body]` with the panes and a pane button that had focus. */
function centerBody(): { body: HTMLElement; panes: HTMLElement; paneButton: HTMLButtonElement } {
  const body = document.createElement("div");
  body.setAttribute("data-vc-center-body", "");
  const panes = document.createElement("div");
  const paneButton = document.createElement("button");
  paneButton.textContent = "Pane composer";
  panes.append(paneButton);
  body.append(panes);
  document.body.append(body);
  return { body, panes, paneButton };
}

function panelIn(body: HTMLElement): HTMLElement {
  const panel = document.createElement("section");
  panel.tabIndex = -1;
  panel.setAttribute("data-vc-cover-panel", "");
  const inside = document.createElement("button");
  inside.textContent = "Inside";
  panel.append(inside);
  body.append(panel);
  return panel;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("coverSplitView", () => {
  it("makes the panes inert, moves focus into the panel and restores both", () => {
    const { body, panes, paneButton } = centerBody();
    paneButton.focus();
    const panel = panelIn(body);

    const release = coverSplitView(panel);
    expect(panes.hasAttribute("inert")).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(panel);

    panel.querySelector("button")!.focus();
    release();
    expect(panes.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(paneButton);
  });

  it("keeps focus where the user moved it before the panel closed", () => {
    const { body, paneButton } = centerBody();
    const tab = document.createElement("button");
    document.body.append(tab);
    paneButton.focus();
    const release = coverSplitView(panelIn(body));
    tab.focus();
    release();
    expect(document.activeElement).toBe(tab);
  });

  it("covers panes mounted while the panel is open, and releases them", async () => {
    const { body } = centerBody();
    const release = coverSplitView(panelIn(body));
    const late = document.createElement("div");
    body.append(late);
    await act(async () => {
      await Promise.resolve();
    });
    expect(late.hasAttribute("inert")).toBe(true);
    release();
    expect(late.hasAttribute("inert")).toBe(false);
  });

  it("leaves an element that was already inert alone", () => {
    const { body, panes } = centerBody();
    panes.setAttribute("inert", "");
    coverSplitView(panelIn(body))();
    expect(panes.hasAttribute("inert")).toBe(true);
  });

  it("keeps the panes inert until the last covering panel lets go", () => {
    const { body, panes } = centerBody();
    const first = panelIn(body);
    const second = panelIn(body);
    const releaseFirst = coverSplitView(first);
    const releaseSecond = coverSplitView(second);
    // Covering panels never make each other inert.
    expect(first.hasAttribute("inert")).toBe(false);
    expect(second.hasAttribute("inert")).toBe(false);
    releaseFirst();
    expect(panes.hasAttribute("inert")).toBe(true);
    releaseSecond();
    expect(panes.hasAttribute("inert")).toBe(false);
  });
});

function HookPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useCoverSplitView(ref);
  return (
    <div ref={ref} tabIndex={-1} data-vc-cover-panel="" aria-label="Hook panel">
      <button type="button">Inside</button>
    </div>
  );
}

/** The center body as React renders it: the panes, then the covering panel(s). */
function CenterBody(props: { children?: ReactNode }) {
  return (
    <div data-vc-center-body="">
      <div data-testid="panes">
        <button type="button">Pane composer</button>
      </div>
      {props.children}
    </div>
  );
}

describe("useCoverSplitView", () => {
  it("covers while mounted and restores on unmount", () => {
    const { rerender } = render(<CenterBody />);
    const panes = screen.getByTestId("panes");
    const paneButton = screen.getByRole("button", { name: "Pane composer" });
    paneButton.focus();
    rerender(
      <CenterBody>
        <HookPanel />
      </CenterBody>,
    );
    expect(panes.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Hook panel");
    rerender(<CenterBody />);
    expect(panes.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(paneButton);
  });
});

describe("RoundtableCenterHost", () => {
  let releaseShell: (() => void) | undefined;

  beforeEach(() => {
    releaseShell = acquireViscosityShellFlag(document.documentElement);
    useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  });

  afterEach(() => {
    releaseShell?.();
    useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  });

  it("makes the split view inert while the Roundtable panel covers it", async () => {
    render(
      <CenterBody>
        <RoundtableCenterHost />
      </CenterBody>,
    );
    const panes = screen.getByTestId("panes");
    const paneButton = screen.getByRole("button", { name: "Pane composer" });
    paneButton.focus();
    expect(panes.hasAttribute("inert")).toBe(false);

    await act(async () => {
      useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    });
    await screen.findByRole("region", { name: "Roundtable rt1" });
    expect(panes.hasAttribute("inert")).toBe(true);
    const panel = document.querySelector<HTMLElement>("[data-vc-roundtable-panel]")!;
    expect(panel.contains(document.activeElement)).toBe(true);

    screen.getByRole("button", { name: "Close Roundtable" }).focus();
    await act(async () => {
      useRoundtableViewStore.setState({ shown: false });
    });
    expect(document.querySelector("[data-vc-roundtable-panel]")).toBeNull();
    expect(panes.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(paneButton);
  });
});
