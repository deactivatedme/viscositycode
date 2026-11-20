// ViscosityCode: fork-only. The desktop shell's replacement for upstream's
// HomeView: "home" becomes a New session draft in the most recently used project.
import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { openNewThread } from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { CreateProjectMenu } from "@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu";
import { resolveNewSessionProjectId } from "./resolveNewSessionProjectId";

/**
 * `redirect` is only for the real `home` view. The other HomeView fallbacks
 * (stale panes, a draft whose project is missing) can be transient while rows
 * merge, so they must not replace the view.
 */
export function NewSessionLanding(props: { redirect: boolean }) {
  const { redirect } = props;
  const hydrated = useSharedSettings((s) => s.sharedSettingsHydrated);
  const homeScopeEnabled = useSharedSettings((s) => s.homeScopeEnabled);
  const target = useAppStore((s) =>
    hydrated ? resolveNewSessionProjectId(s, homeScopeEnabled) : undefined,
  );

  useEffect(() => {
    // Never openNewThread here: with no project it opens home again and loops.
    if (redirect && target) useAppStore.getState().openDraft(target);
  }, [redirect, target]);

  return (
    <div
      data-vc-new-session-landing=""
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <h1 className="sr-only">
        <Trans>New session</Trans>
      </h1>
      {hydrated && !target ? (
        <>
          <p className="text-sm text-muted">
            <Trans>Add a folder to start</Trans>
          </p>
          <CreateProjectMenu>
            <Button size="sm" variant="secondary">
              <Plus aria-hidden="true" className="size-3.5" />
              <Trans>Add folder</Trans>
            </Button>
          </CreateProjectMenu>
        </>
      ) : null}
      {!redirect && target ? (
        <Button size="sm" variant="secondary" onPress={() => openNewThread()}>
          <Trans>New session</Trans>
        </Button>
      ) : null}
    </div>
  );
}
