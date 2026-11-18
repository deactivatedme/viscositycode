import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
// ViscosityCode: account pools — "<account> · 62% left" for a pooled thread.
import { registerAccountPoolStatusBarItem } from "@/renderer/viscosity/accountPools/AccountPoolStatusItem";
import { registerBuiltinStatusBarItems } from "./builtinStatusBarItems";
import { type StatusBarItem, useStatusBarItems } from "./statusBarRegistry";

registerBuiltinStatusBarItems();
registerAccountPoolStatusBarItem(); // ViscosityCode: account pools.

function StatusBarSlot(props: { item: StatusBarItem }) {
  const Item = props.item.component;
  return <Item />;
}

/** Compact status bar along the bottom of the main window (registry-driven). */
export function ViscosityStatusBar() {
  const { t } = useLingui();
  const items = useStatusBarItems();
  const left = items.filter((item) => item.align === "left");
  const right = items.filter((item) => item.align === "right");
  return (
    <footer
      data-vc-statusbar=""
      aria-label={t`Status bar`}
      className="vc-statusbar flex h-[var(--vc-statusbar-height)] w-full shrink-0 items-stretch justify-between overflow-hidden"
    >
      <div className="vc-statusbar__side flex min-w-0 items-stretch overflow-hidden">
        {left.map((item) => (
          <StatusBarSlot key={item.key} item={item} />
        ))}
      </div>
      <div className="vc-statusbar__side flex min-w-0 shrink-0 items-stretch justify-end">
        {right.map((item) => (
          <StatusBarSlot key={item.key} item={item} />
        ))}
      </div>
    </footer>
  );
}

/**
 * Wraps the main window's layout so the status bar sits below the whole shell,
 * full width. Outside the fork's desktop shell the layout renders unchanged.
 *
 * The frame holds `html[data-vc-shell]` itself (reference counted with the
 * main AppShell), so the bar is styled whenever it renders. MainView mounts it
 * around the main layout only, inside the browser client's connection gate, so
 * the connection page and its loader never get a status bar.
 */
export function ViscosityStatusBarFrame(props: { children: ReactNode }) {
  const enabled = useViscosityShellFlag();
  if (!enabled) return props.children;
  return (
    <div data-vc-frame="" className="flex h-full min-h-0 w-full flex-col">
      <div className="relative min-h-0 flex-1">{props.children}</div>
      <ViscosityStatusBar />
    </div>
  );
}
