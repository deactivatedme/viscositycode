import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearZenFocusedPane,
  markZenFocusedPane,
  startZenFocusPaneTracker,
  ZEN_PANE_ATTRIBUTE,
  ZEN_SPLIT_ATTRIBUTE,
} from "./zenFocusPane";

const DRAFT_A = "draft:project-1#a";
const DRAFT_B = "draft:project-1#b";

type PaneSpec = string | { draft: true };

/**
 * Mirrors ViscosityCenterFrame > SplitPaneContainer > slot > pane wrapper >
 * ThreadView (a thread id) or ThreadDraftView (`{ draft: true }`).
 */
function renderSplit(panes: PaneSpec[]) {
  const centerBody = document.createElement("div");
  centerBody.setAttribute("data-vc-center-body", "");
  const container = document.createElement("div");
  container.className = "relative h-full";
  const split = document.createElement("div");
  split.className = "absolute";
  split.style.inset = "0";
  const slots = panes.map((spec, index) => {
    const slot = document.createElement("div");
    slot.className = "absolute overflow-hidden";
    slot.style.left = `${index * 100}px`;
    slot.style.top = "0px";
    slot.style.width = "100px";
    slot.style.height = "100px";
    const paneWrapper = document.createElement("div");
    paneWrapper.tabIndex = -1;
    const pane = document.createElement("div");
    if (typeof spec === "string") {
      pane.setAttribute("data-poracode-thread-pane", "");
      pane.setAttribute("data-vc-thread-id", spec);
    } else {
      pane.setAttribute("data-draft-composer", "");
      pane.append(document.createElement("textarea"));
    }
    paneWrapper.append(pane);
    slot.append(paneWrapper);
    split.append(slot);
    return slot;
  });
  const divider = document.createElement("div");
  divider.className = "poracode-pane-divider";
  split.append(divider);
  container.append(split);
  centerBody.append(container);
  document.body.append(centerBody);
  return { split, slots, divider };
}

function tagged(): Element[] {
  return [...document.querySelectorAll(`[${ZEN_PANE_ATTRIBUTE}], [${ZEN_SPLIT_ATTRIBUTE}]`)];
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("markZenFocusedPane", () => {
  it("tags the focused pane's slot and its split container", () => {
    const { split, slots } = renderSplit(["a", "b", "c"]);
    expect(markZenFocusedPane(document, "b")).toBe(true);
    expect(slots[1]?.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(true);
    expect(split.hasAttribute(ZEN_SPLIT_ATTRIBUTE)).toBe(true);
    expect(tagged()).toEqual([split, slots[1]]);
  });

  it("moves the tag when focus moves", () => {
    const { split, slots } = renderSplit(["a", "b"]);
    markZenFocusedPane(document, "a");
    markZenFocusedPane(document, "b");
    expect(tagged()).toEqual([split, slots[1]]);
  });

  it("tags nothing when the focused pane is unknown, a draft or off screen", () => {
    const { slots } = renderSplit(["a", "b"]);
    markZenFocusedPane(document, "a");
    expect(markZenFocusedPane(document, "draft-1")).toBe(false);
    expect(tagged()).toEqual([]);
    expect(markZenFocusedPane(document, null)).toBe(false);

    slots[0]
      ?.querySelector("[data-poracode-thread-pane]")
      ?.setAttribute("data-poracode-pane-hidden", "");
    expect(markZenFocusedPane(document, "a")).toBe(false);
  });

  it("ignores panes outside the fork's center column", () => {
    const pane = document.createElement("div");
    pane.setAttribute("data-poracode-thread-pane", "");
    pane.setAttribute("data-vc-thread-id", "a");
    document.body.append(pane);
    expect(markZenFocusedPane(document, "a")).toBe(false);
  });

  it("tags the split's only draft pane when a draft is focused", () => {
    const { split, slots } = renderSplit(["a", { draft: true }]);
    expect(markZenFocusedPane(document, DRAFT_A)).toBe(true);
    expect(tagged()).toEqual([split, slots[1]]);
  });

  it("tags the draft slot known to show the focused draft, and only an unclaimed one otherwise", () => {
    const { split, slots } = renderSplit([{ draft: true }, "t", { draft: true }]);
    // Two drafts and nothing known: ambiguous, so the split stays as it is.
    expect(markZenFocusedPane(document, DRAFT_A)).toBe(false);

    const known = new Map<HTMLElement, string>([[slots[2]!, DRAFT_B]]);
    const slotPaneId = (slot: HTMLElement) => known.get(slot);
    expect(markZenFocusedPane(document, DRAFT_B, slotPaneId)).toBe(true);
    expect(tagged()).toEqual([split, slots[2]]);
    // The other draft is the only slot not claimed by another pane.
    expect(markZenFocusedPane(document, DRAFT_A, slotPaneId)).toBe(true);
    expect(tagged()).toEqual([split, slots[0]]);
  });

  it("ignores a draft inside a thread pane (its side chat)", () => {
    const { slots } = renderSplit(["a"]);
    const sideChat = document.createElement("div");
    sideChat.setAttribute("data-draft-composer", "");
    slots[0]?.querySelector("[data-poracode-thread-pane]")?.append(sideChat);
    expect(markZenFocusedPane(document, DRAFT_A)).toBe(false);
  });

  it("clears every tag", () => {
    renderSplit(["a"]);
    markZenFocusedPane(document, "a");
    clearZenFocusedPane(document);
    expect(tagged()).toEqual([]);
  });
});

describe("startZenFocusPaneTracker", () => {
  it("tags at once, re-tags one frame after a change and clears on dispose", () => {
    const { slots } = renderSplit(["a", "b"]);
    let focused = "a";
    let notify: () => void = () => {};
    const frames: Array<() => void> = [];
    const unsubscribe = vi.fn<() => void>();
    const dispose = startZenFocusPaneTracker({
      root: document,
      readFocusedPaneId: () => focused,
      subscribe: (listener) => {
        notify = listener;
        return unsubscribe;
      },
      requestFrame: (callback) => frames.push(callback),
      cancelFrame: () => {},
    });
    expect(slots[0]?.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(true);
    frames.splice(0).forEach((callback) => callback());

    focused = "b";
    notify();
    notify();
    expect(frames).toHaveLength(1);
    frames.splice(0).forEach((callback) => callback());
    expect(slots[1]?.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(true);
    expect(slots[0]?.hasAttribute(ZEN_PANE_ATTRIBUTE)).toBe(false);

    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(tagged()).toEqual([]);
  });

  it("learns which slot shows which draft from focus, and forgets panes that are gone", () => {
    const { split, slots } = renderSplit([{ draft: true }, { draft: true }]);
    let focused = DRAFT_B;
    let paneIds: string[] = [DRAFT_A, DRAFT_B];
    const frames: Array<() => void> = [];
    let notify: () => void = () => {};
    // The split's own capture listener sets the focused pane as focus enters it.
    const focusPane = (index: number, paneId: string, target: "composer" | "pane" = "composer") => {
      const slot = slots[index]!;
      slot.addEventListener("focusin", () => (focused = paneId), { capture: true, once: true });
      const element =
        target === "composer" ? slot.querySelector("textarea") : slot.firstElementChild;
      (element as HTMLElement).focus();
    };
    const dispose = startZenFocusPaneTracker({
      root: document,
      readFocusedPaneId: () => focused,
      readPaneIds: () => paneIds,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      requestFrame: (callback) => frames.push(callback),
      cancelFrame: () => {},
    });
    const runFrames = () => frames.splice(0).forEach((callback) => callback());
    // Two drafts, neither focused yet: ambiguous.
    expect(tagged()).toEqual([]);

    focusPane(1, DRAFT_B);
    runFrames();
    expect(tagged()).toEqual([split, slots[1]]);

    // Focus moves in the store only (no DOM focus): the other draft is unclaimed.
    focused = DRAFT_A;
    notify();
    runFrames();
    expect(tagged()).toEqual([split, slots[0]]);

    // Draft B is gone (replaced in place by a new draft): its slot is free again.
    paneIds = [DRAFT_A, "draft:project-2#c"];
    focused = "draft:project-2#c";
    notify();
    runFrames();
    expect(tagged()).toEqual([]);
    focusPane(1, "draft:project-2#c", "pane");
    runFrames();
    expect(tagged()).toEqual([split, slots[1]]);

    dispose();
    expect(tagged()).toEqual([]);
  });

  it("learns the draft that has focus when zen mode starts", () => {
    const { split, slots } = renderSplit([{ draft: true }, { draft: true }]);
    slots[0]!.querySelector("textarea")!.focus();
    const dispose = startZenFocusPaneTracker({
      root: document,
      readFocusedPaneId: () => DRAFT_A,
      subscribe: () => () => {},
      requestFrame: () => 0,
      cancelFrame: () => {},
    });
    expect(tagged()).toEqual([split, slots[0]]);
    dispose();
  });
});
