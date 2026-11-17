/**
 * ViscosityCode: wiring between AppShell and the main-window Sidebar.
 *
 * AppShell is shared by the main window and full-window overlays (Settings,
 * Git review, …). Only the shell that hosts the main projects/threads Sidebar
 * gets the activity bar. The Sidebar component marks itself once at module
 * load, so AppShell can tell from its `sidebar` element on the very first
 * render (no extra commit, no width animation at startup), and AppShell tells
 * the Sidebar through context whether the activity bar is showing (it
 * replaces upstream's collapsed icon rail).
 */
import {
  type ComponentType,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
} from "react";

const mainSidebarComponents = new WeakSet<object>();

/** Mark a component as the main-window projects/threads sidebar. */
export function markMainSidebarComponent(component: ComponentType): void {
  mainSidebarComponents.add(component);
}

/** True when `node` is an element of a component marked as the main sidebar. */
export function isMainSidebarElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const type: unknown = node.type;
  return typeof type === "function" && mainSidebarComponents.has(type);
}

const ActivityBarActiveContext = createContext(false);

export function ActivityBarActiveProvider(props: { value: boolean; children: ReactNode }) {
  return <ActivityBarActiveContext value={props.value}>{props.children}</ActivityBarActiveContext>;
}

/** Whether the enclosing shell renders the activity bar. */
export function useActivityBarActive(): boolean {
  return useContext(ActivityBarActiveContext);
}
