import { afterEach, describe, expect, it } from "vitest";
import {
  createFxDomApplicator,
  FX_ENERGY_PROPERTY,
  FX_FLASH_ATTRIBUTE,
  FX_STATE_ATTRIBUTE,
  type FxDomFrame,
  type FxThreadVisual,
  resolvePaneThreadIds,
} from "./domApplicator";

function element(attributes: Record<string, string>, ...children: Element[]): HTMLElement {
  const node = document.createElement(attributes.tag ?? "div");
  for (const [name, value] of Object.entries(attributes)) {
    if (name !== "tag") node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function chatPane(threadId: string, extra: Record<string, string> = {}): HTMLElement {
  return element(
    { "data-poracode-thread-pane": "", ...extra },
    element({ "data-poracode-thread-header": "" }),
    element({ "data-thread-id": threadId }),
  );
}

function terminalPane(extra: Record<string, string> = {}): HTMLElement {
  return element({ "data-poracode-thread-pane": "", ...extra }, element({ class: "xterm" }));
}

function tab(threadId: string): HTMLElement {
  return element(
    { class: "vc-tab" },
    element(
      { tag: "button", "data-vc-tab-id": threadId },
      element({ tag: "span", class: "vc-tab__dot" }),
    ),
  );
}

function mount(...nodes: Element[]): void {
  document.body.replaceChildren(...nodes);
}

function visual(patch: Partial<FxThreadVisual> = {}): FxThreadVisual {
  return { state: "working", flash: null, energy: null, ...patch };
}

function setup(...nodes: Element[]) {
  mount(...nodes);
  const frames: (() => void)[] = [];
  let frame: FxDomFrame = { threads: new Map(), paneThreadIds: [] };
  const applicator = createFxDomApplicator({
    document,
    readFrame: () => frame,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: (handle) => {
      frames[handle - 1] = () => {};
    },
  });
  return {
    applicator,
    frames,
    setFrame(threads: Record<string, FxThreadVisual>, paneThreadIds: string[] = []) {
      frame = { threads: new Map(Object.entries(threads)), paneThreadIds };
    },
    runFrames() {
      for (const callback of frames.splice(0)) callback();
    },
  };
}

const panes = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-poracode-thread-pane]"));
const tabButton = (id: string) => document.querySelector<HTMLElement>(`[data-vc-tab-id="${id}"]`)!;

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolvePaneThreadIds", () => {
  it("prefers the pane's own id, then the chat pane id", () => {
    mount(chatPane("chat"), terminalPane({ "data-vc-thread-id": "term" }));
    expect(resolvePaneThreadIds(panes(), [])).toEqual(["chat", "term"]);
  });

  it("matches one unlabeled pane by elimination", () => {
    mount(chatPane("chat"), terminalPane());
    expect(resolvePaneThreadIds(panes(), ["chat", "term"])).toEqual(["chat", "term"]);
  });

  it("leaves ambiguous panes unresolved", () => {
    mount(terminalPane(), terminalPane());
    expect(resolvePaneThreadIds(panes(), ["a", "b"])).toEqual([null, null]);
  });
});

describe("fx DOM applicator", () => {
  it("batches writes into one animation frame", () => {
    const harness = setup(chatPane("a"), tab("a"));
    harness.setFrame({ a: visual({ state: "thinking" }) });
    harness.applicator.schedule();
    harness.applicator.schedule();
    expect(harness.frames).toHaveLength(1);
    expect(panes()[0]!.hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    harness.runFrames();
    expect(panes()[0]!.getAttribute(FX_STATE_ATTRIBUTE)).toBe("thinking");
    expect(tabButton("a").getAttribute(FX_STATE_ATTRIBUTE)).toBe("thinking");
  });

  it("sets and clears state, flash and pane energy", () => {
    const harness = setup(chatPane("a"), tab("a"));
    harness.setFrame({ a: visual({ state: "streaming", flash: "done", energy: 0.456 }) });
    harness.applicator.flush();
    const pane = panes()[0]!;
    expect(pane.getAttribute(FX_FLASH_ATTRIBUTE)).toBe("done");
    expect(pane.style.getPropertyValue(FX_ENERGY_PROPERTY)).toBe("0.46");
    expect(tabButton("a").getAttribute(FX_FLASH_ATTRIBUTE)).toBe("done");
    expect(tabButton("a").style.getPropertyValue(FX_ENERGY_PROPERTY)).toBe("");

    harness.setFrame({ a: visual({ state: "idle" }) });
    harness.applicator.flush();
    expect(pane.getAttribute(FX_STATE_ATTRIBUTE)).toBe("idle");
    expect(pane.hasAttribute(FX_FLASH_ATTRIBUTE)).toBe(false);
    expect(pane.style.getPropertyValue(FX_ENERGY_PROPERTY)).toBe("");
  });

  it("omits the attribute for a switched-off effect (null state)", () => {
    const harness = setup(chatPane("a"));
    harness.setFrame({ a: visual({ state: "tool" }) });
    harness.applicator.flush();
    harness.setFrame({ a: visual({ state: null }) });
    harness.applicator.flush();
    expect(panes()[0]!.hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
  });

  it("clears elements whose thread left the frame and skips hidden panes", () => {
    const harness = setup(
      chatPane("a"),
      chatPane("b", { "data-poracode-pane-hidden": "true" }),
      tab("a"),
      tab("b"),
    );
    harness.setFrame({ a: visual(), b: visual({ state: "attention" }) });
    harness.applicator.flush();
    const [paneA, hiddenB] = panes();
    expect(hiddenB!.hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    expect(tabButton("b").getAttribute(FX_STATE_ATTRIBUTE)).toBe("attention");

    harness.setFrame({ b: visual({ state: "attention" }) });
    harness.applicator.flush();
    expect(paneA!.hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    expect(tabButton("a").hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
  });

  it("follows a pane slot that now shows another thread", () => {
    const harness = setup(chatPane("a"));
    harness.setFrame({ a: visual({ state: "tool" }), b: visual({ state: "thinking" }) });
    harness.applicator.flush();
    panes()[0]!.querySelector("[data-thread-id]")!.setAttribute("data-thread-id", "b");
    harness.applicator.flush();
    expect(panes()[0]!.getAttribute(FX_STATE_ATTRIBUTE)).toBe("thinking");
  });

  it("labels a terminal pane by elimination", () => {
    const harness = setup(chatPane("chat"), terminalPane());
    harness.setFrame(
      { chat: visual({ state: "streaming", energy: 0.2 }), term: visual({ state: "attention" }) },
      ["chat", "term"],
    );
    harness.applicator.flush();
    expect(panes()[1]!.getAttribute(FX_STATE_ATTRIBUTE)).toBe("attention");
  });

  it("does not rewrite unchanged values", async () => {
    const harness = setup(chatPane("a"));
    harness.setFrame({ a: visual({ state: "tool" }) });
    harness.applicator.flush();
    const pane = panes()[0]!;
    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    observer.observe(pane, { attributes: true });
    harness.applicator.flush();
    harness.applicator.flush();
    await Promise.resolve();
    observer.disconnect();
    expect(writes).toBe(0);
  });

  it("clear() and dispose() remove everything and cancel the pending frame", () => {
    const harness = setup(chatPane("a"), tab("a"));
    harness.setFrame({ a: visual({ state: "tool", flash: "error" }) });
    harness.applicator.flush();
    harness.applicator.clear();
    expect(panes()[0]!.hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    expect(panes()[0]!.hasAttribute(FX_FLASH_ATTRIBUTE)).toBe(false);
    expect(tabButton("a").hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);

    harness.applicator.schedule();
    harness.applicator.dispose();
    harness.runFrames();
    expect(panes()[0]!.hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    harness.applicator.schedule();
    expect(harness.frames).toHaveLength(0);
  });
});
