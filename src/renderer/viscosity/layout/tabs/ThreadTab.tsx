import { Button } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { getStatusTone } from "@/renderer/components/providers/statusTone";
import {
  selectFocusedThreadId,
  useThreadHasBackgroundActivity,
} from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useThread } from "@/renderer/state/useThread";
import {
  isRoundtablePanelShown,
  useRoundtableViewStore,
} from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { activateThreadTab, closeThreadTab } from "./tabActions";

/** One open-thread tab. Subscribes only to its own thread and selection flags. */
export function ThreadTab(props: { threadId: string }) {
  const { threadId } = props;
  const { t } = useLingui();
  const thread = useThread(threadId);
  // Like the sidebar, acknowledge a click a frame before `openThread` swaps the pane.
  const isFocused = useAppStore((state) =>
    state.pendingActiveThreadId !== null
      ? state.pendingActiveThreadId === threadId
      : selectFocusedThreadId(state) === threadId,
  );
  const isOnScreen = useAppStore(
    (state) => state.view.kind === "thread" && state.view.panes.includes(threadId),
  );
  const editorShown = useFileEditorStore(
    (state) => state.overlayMode === "modal" && state.rootContext !== null,
  );
  // ViscosityCode: the Roundtable panel covers the panes like the editor does.
  const roundtableShown = useRoundtableViewStore(isRoundtablePanelShown);
  const hasBackgroundActivity = useThreadHasBackgroundActivity(threadId);
  if (!thread) return null;

  const tone = getStatusTone(thread, { hasBackgroundActivity });
  const selected = isFocused && !editorShown && !roundtableShown;

  return (
    // Middle-click closing is delegated to the tab strip via `data-vc-tab-thread`.
    <div
      data-vc-tab=""
      data-vc-tab-thread={threadId}
      data-selected={selected || undefined}
      data-on-screen={isOnScreen || undefined}
      className="vc-tab group relative flex min-w-0 shrink-0 items-center"
    >
      <Button
        render={(buttonProps) => (
          <button
            {...buttonProps}
            type="button"
            role="tab"
            aria-selected={selected}
            data-vc-tab-id={threadId}
            title={thread.title}
          />
        )}
        variant="ghost"
        size="sm"
        className="vc-tab__main flex h-full min-w-0 items-center justify-start gap-1.5 rounded-none font-normal"
        onPress={() => activateThreadTab(threadId)}
      >
        <ThreadProviderIcon thread={thread} tone={tone} className="size-3.5 shrink-0" />
        <span className="vc-tab__title min-w-0 truncate">{thread.title}</span>
        <span aria-hidden="true" className="vc-tab__dot" data-tone={tone} />
      </Button>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t`Close ${thread.title}`}
        excludeFromTabOrder
        className="vc-tab__close min-w-0 shrink-0 p-0"
        onPress={() => closeThreadTab(threadId)}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
