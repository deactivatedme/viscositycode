/**
 * ViscosityCode Explorer view: upstream's project file tree, shown in the LEFT
 * sidebar for the current project. Selecting a file opens it in the existing
 * editor panel without also opening the right-panel Files tab.
 */
import { toast } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { activateFileEditorContext } from "@/renderer/actions/fileEditorContext";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { ProjectTreeView } from "@/renderer/views/FileEditorOverlay/parts/ProjectTreeView/ProjectTreeView";
import type { ActivitySidebarViewProps } from "./activityBarRegistry";
import { useExplorerRootContext } from "./explorerRoot";

function ExplorerNotice(props: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4">
      <p className="text-center text-sm text-muted">{props.children}</p>
    </div>
  );
}

export function ExplorerSidebarView(props: ActivitySidebarViewProps) {
  const rootContext = useExplorerRootContext();
  const overlayMode = useFileEditorStore((state) => state.overlayMode);
  const pinTab = useFileEditorStore((state) => state.pinTab);

  if (!rootContext) {
    return (
      <ExplorerNotice>
        <Trans>Add a project to browse its files</Trans>
      </ExplorerNotice>
    );
  }
  // The full-screen editor owns the tree while it is open (same rule as the
  // right-panel Files tab): two mounted trees would share one loader.
  if (overlayMode === "fullscreen") {
    return (
      <ExplorerNotice>
        <Trans>The file tree is open in the full-screen editor</Trans>
      </ExplorerNotice>
    );
  }

  function handleSelectFile(path: string) {
    if (!rootContext || !activateFileEditorContext(rootContext)) return;
    void useFileEditorStore
      .getState()
      .openFile(path, "modal", true)
      .catch((error: unknown) =>
        toast.danger(error instanceof Error ? error.message : String(error)),
      );
  }

  return (
    <div className="vc-explorer-view flex h-full min-h-0 min-w-0 flex-col px-2">
      <ProjectTreeView
        rootContext={rootContext}
        visible={props.visible}
        onSelectFile={handleSelectFile}
        onPinFile={pinTab}
      />
    </div>
  );
}
