import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Observed width of the activity bar (0 while it is not rendered). AppShell
 * subtracts it from the shell width when deciding the narrow sidebar overlay
 * and the right-panel overlay, since the bar sits inside the shell row.
 */
export function useActivityBarWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const update = () => {
      const next = el.getBoundingClientRect().width;
      setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, ref]);
  return enabled ? width : 0;
}
