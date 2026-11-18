import { afterEach, describe, expect, it } from "vitest";
import { startZenPillReserve, ZEN_PILL_WIDTH_PROPERTY } from "./zenPillReserve";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function pillOfWidth(width: { current: number }): HTMLElement {
  const pill = document.createElement("button");
  pill.getBoundingClientRect = () => ({ width: width.current }) as DOMRect;
  return pill;
}

const root = document.documentElement;

afterEach(() => {
  FakeResizeObserver.instances = [];
  root.style.removeProperty(ZEN_PILL_WIDTH_PROPERTY);
});

describe("startZenPillReserve", () => {
  it("publishes the pill's width on <html>, follows its resizes and removes it on dispose", () => {
    const width = { current: 96.2 };
    const dispose = startZenPillReserve({
      pill: pillOfWidth(width),
      root,
      ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
    });
    expect(root.style.getPropertyValue(ZEN_PILL_WIDTH_PROPERTY)).toBe("97px");

    const observer = FakeResizeObserver.instances[0]!;
    width.current = 132;
    observer.fire();
    expect(root.style.getPropertyValue(ZEN_PILL_WIDTH_PROPERTY)).toBe("132px");

    dispose();
    expect(observer.disconnected).toBe(true);
    expect(root.style.getPropertyValue(ZEN_PILL_WIDTH_PROPERTY)).toBe("");
  });

  it("keeps the stylesheet fallback while the pill has no width yet", () => {
    const width = { current: 0 };
    const dispose = startZenPillReserve({
      pill: pillOfWidth(width),
      root,
      ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
    });
    expect(root.style.getPropertyValue(ZEN_PILL_WIDTH_PROPERTY)).toBe("");
    width.current = 110;
    FakeResizeObserver.instances[0]!.fire();
    expect(root.style.getPropertyValue(ZEN_PILL_WIDTH_PROPERTY)).toBe("110px");
    dispose();
  });
});
