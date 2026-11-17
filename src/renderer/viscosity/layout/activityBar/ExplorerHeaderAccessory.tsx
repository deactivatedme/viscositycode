import { useExplorerRootContext } from "./explorerRoot";

/** Explorer title-row accessory: the root being browsed (project or worktree branch). */
export function ExplorerHeaderAccessory() {
  const rootContext = useExplorerRootContext();
  if (!rootContext) return null;
  return (
    <span className="vc-sidebar-view-subtitle" title={rootContext.rootLabel}>
      {rootContext.rootLabel}
    </span>
  );
}
