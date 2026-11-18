import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  acquireViscosityShellFlag,
  VISCOSITY_SHELL_ATTRIBUTE,
} from "@/renderer/viscosity/shellFlag";
import { ZenModeHost } from "./ZenModeHost";
import { ZEN_PANE_ATTRIBUTE } from "./zenFocusPane";
import { enterZenMode, exitZenMode, isZenModeActive, ZEN_ATTRIBUTE } from "./zenModeStore";
import { ZEN_REVEAL_ATTRIBUTE } from "./zenReveal";

const root = document.documentElement;
let releaseShell: (() => void) | null = null;

function pill(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-vc-zen-exit]");
}

beforeEach(() => {
  releaseShell = acquireViscosityShellFlag(root);
  useAppStore.setState({ focusedPaneId: null });
});

afterEach(() => {
  act(() => {
    exitZenMode();
  });
  releaseShell?.();
  releaseShell = null;
  root.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  vi.useRealTimers();
});

describe("ZenModeHost", () => {
  it("renders nothing while zen mode is off", () => {
    render(<ZenModeHost />);
    expect(pill()).toBeNull();
    expect(document.querySelector("[data-vc-zen-hotzone]")).toBeNull();
  });

  it("shows a keyboard-reachable Exit Zen pill and the reveal band while on", () => {
    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    const button = screen.getByRole("button", { name: "Exit Zen mode" });
    expect(button).toBe(pill());
    const keyHint = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(keyHint?.textContent).toBe("Esc");
    expect(button.textContent).toContain("Exit Zen");
    expect(button.tabIndex).not.toBe(-1);
    expect(document.querySelector("[data-vc-zen-hotzone]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("exits from the pill and hands focus back to where it was", () => {
    const composer = document.createElement("textarea");
    document.body.append(composer);
    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    composer.focus();
    const button = pill()!;
    act(() => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);
    act(() => {
      fireEvent.click(button);
    });
    expect(isZenModeActive()).toBe(false);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
    expect(pill()).toBeNull();
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });

  it("exits on Escape", () => {
    vi.useFakeTimers();
    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => {
      vi.runAllTimers();
    });
    expect(isZenModeActive()).toBe(false);
    expect(pill()).toBeNull();
  });

  it("hands focus back when Escape exits from the focused pill, and leaves other focus alone", () => {
    vi.useFakeTimers();
    const composer = document.createElement("textarea");
    const search = document.createElement("input");
    document.body.append(composer, search);
    render(<ZenModeHost />);

    act(() => {
      enterZenMode();
    });
    composer.focus();
    act(() => {
      pill()!.focus();
    });
    expect(document.activeElement).toBe(pill());
    fireEvent.keyDown(pill()!, { key: "Escape" });
    act(() => {
      vi.runAllTimers();
    });
    expect(isZenModeActive()).toBe(false);
    expect(document.activeElement).toBe(composer);

    act(() => {
      enterZenMode();
    });
    composer.focus();
    act(() => {
      pill()!.focus();
    });
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    act(() => {
      vi.runAllTimers();
    });
    expect(isZenModeActive()).toBe(false);
    expect(document.activeElement).toBe(search);
    composer.remove();
    search.remove();
  });

  it("keeps zen mode when a terminal takes the Escape", () => {
    vi.useFakeTimers();
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const input = document.createElement("textarea");
    terminal.append(input);
    document.body.append(terminal);
    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    fireEvent.keyDown(input, { key: "Escape" });
    act(() => {
      vi.runAllTimers();
    });
    expect(isZenModeActive()).toBe(true);
    terminal.remove();
  });

  it("reveals the tab strip from the top band", () => {
    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    const band = document.querySelector("[data-vc-zen-hotzone]")!;
    band.dispatchEvent(new MouseEvent("pointerenter"));
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(true);
    act(() => {
      exitZenMode();
    });
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(false);
  });

  it("tags the focused pane while on and clears it on exit", () => {
    const centerBody = document.createElement("div");
    centerBody.setAttribute("data-vc-center-body", "");
    const split = document.createElement("div");
    const slot = document.createElement("div");
    slot.style.left = "0px";
    slot.style.width = "50%";
    const pane = document.createElement("div");
    pane.setAttribute("data-poracode-thread-pane", "");
    pane.setAttribute("data-vc-thread-id", "t1");
    slot.append(pane);
    split.append(slot);
    centerBody.append(split);
    document.body.append(centerBody);
    useAppStore.setState({ focusedPaneId: "t1" });

    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    expect(slot.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(true);
    act(() => {
      exitZenMode();
    });
    expect(slot.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(false);
    centerBody.remove();
  });

  it("shows only a focused draft pane of a split, learning its slot from focus", () => {
    const draftA = "draft:p1#a";
    const draftB = "draft:p1#b";
    const centerBody = document.createElement("div");
    centerBody.setAttribute("data-vc-center-body", "");
    const split = document.createElement("div");
    const slots = [draftA, draftB].map((paneId, index) => {
      const slot = document.createElement("div");
      slot.style.left = `${index * 50}%`;
      slot.style.width = "50%";
      const wrapper = document.createElement("div");
      // The split's focus handler (AppContent) marks the pane focus enters.
      wrapper.addEventListener(
        "focusin",
        () => useAppStore.setState({ focusedPaneId: paneId }),
        true,
      );
      const draft = document.createElement("div");
      draft.setAttribute("data-draft-composer", "");
      draft.append(document.createElement("textarea"));
      wrapper.append(draft);
      slot.append(wrapper);
      split.append(slot);
      return slot;
    });
    centerBody.append(split);
    document.body.append(centerBody);
    const previousView = useAppStore.getState().view;
    useAppStore.setState({
      view: { kind: "thread", panes: [draftA, draftB] },
      focusedPaneId: null,
    });
    slots[1]!.querySelector("textarea")!.focus();

    render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    expect(slots[1]!.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(true);
    expect(slots[0]!.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(false);
    act(() => {
      exitZenMode();
    });
    expect(slots[1]!.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(false);
    useAppStore.setState({ view: previousView });
    centerBody.remove();
  });

  it("turns zen mode off when the desktop shell unmounts it", () => {
    const { unmount } = render(<ZenModeHost />);
    act(() => {
      enterZenMode();
    });
    unmount();
    expect(isZenModeActive()).toBe(false);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
  });
});
