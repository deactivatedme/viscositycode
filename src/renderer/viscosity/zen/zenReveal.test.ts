import { afterEach, describe, expect, it } from "vitest";
import { startZenReveal, ZEN_REVEAL_ATTRIBUTE, ZEN_REVEAL_SLACK_PX } from "./zenReveal";

const root = document.documentElement;

function pointer(type: string, target: EventTarget, clientY = 0): void {
  target.dispatchEvent(new MouseEvent(type, { clientY, bubbles: type === "pointermove" }));
}

function setup() {
  const hotZone = document.createElement("div");
  document.body.append(hotZone);
  const dispose = startZenReveal({ root, hotZone, document });
  return { hotZone, dispose };
}

afterEach(() => {
  root.removeAttribute(ZEN_REVEAL_ATTRIBUTE);
  document.body.replaceChildren();
});

describe("startZenReveal", () => {
  it("reveals the strip when the pointer enters the top band", () => {
    const { hotZone, dispose } = setup();
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(false);
    pointer("pointerenter", hotZone);
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(true);
    dispose();
  });

  it("keeps it while the pointer stays near the band, hides it below", () => {
    const { hotZone, dispose } = setup();
    pointer("pointerenter", hotZone);
    // jsdom lays nothing out: the band's bottom is 0.
    pointer("pointermove", document.body, ZEN_REVEAL_SLACK_PX);
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(true);
    pointer("pointermove", document.body, ZEN_REVEAL_SLACK_PX + 1);
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(false);

    pointer("pointerenter", hotZone);
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(true);
    dispose();
  });

  it("hides it when the pointer leaves the window", () => {
    const { hotZone, dispose } = setup();
    pointer("pointerenter", hotZone);
    pointer("pointerleave", root);
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(false);
    dispose();
  });

  it("cleans up on dispose", () => {
    const { hotZone, dispose } = setup();
    pointer("pointerenter", hotZone);
    dispose();
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(false);
    pointer("pointerenter", hotZone);
    expect(root.hasAttribute(ZEN_REVEAL_ATTRIBUTE)).toBe(false);
  });
});
