import { Button } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { FileCode } from "lucide-react";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { toggleEditorTab } from "./tabActions";

/** Pinned "Editor" tab while the file editor has open files; toggles its inline panel. */
export function EditorTab() {
  const { t } = useLingui();
  const hasOpenFiles = useFileEditorStore(
    (state) => state.rootContext !== null && state.tabs.length > 0,
  );
  const shown = useFileEditorStore(
    (state) => state.overlayMode === "modal" && state.rootContext !== null,
  );
  const hasUnsavedChanges = useFileEditorStore((state) =>
    Object.values(state.buffers).some((buffer) => buffer.status === "ready" && buffer.isDirty),
  );
  if (!hasOpenFiles) return null;

  return (
    <div
      data-vc-tab=""
      data-vc-editor-tab=""
      data-selected={shown || undefined}
      className="vc-tab vc-tab--editor relative flex shrink-0 items-center"
    >
      <Button
        render={(buttonProps) => (
          <button {...buttonProps} type="button" role="tab" aria-selected={shown} />
        )}
        variant="ghost"
        size="sm"
        aria-label={shown ? t`Hide editor` : t`Show editor`}
        className="vc-tab__main flex h-full min-w-0 items-center justify-start gap-1.5 rounded-none font-normal"
        onPress={toggleEditorTab}
      >
        <FileCode aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="vc-tab__title truncate">{t`Editor`}</span>
        {hasUnsavedChanges ? (
          <span aria-hidden="true" className="vc-tab__dot" data-tone="attention" />
        ) : null}
      </Button>
    </div>
  );
}
