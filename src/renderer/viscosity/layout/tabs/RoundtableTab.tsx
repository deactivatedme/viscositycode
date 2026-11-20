import { Button } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { UsersRound, X } from "lucide-react";
import { useRoundtableSession } from "@/renderer/viscosity/roundtable/api";
import { isChatIdle, sessionTone } from "@/renderer/viscosity/roundtable/ui/patterns";
import {
  closeRoundtableView,
  isRoundtablePanelShown,
  showRoundtablePanel,
  useRoundtableViewStore,
} from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";

/**
 * Pinned "Roundtable" tab while a Roundtable session is open (modelled on the
 * Editor tab): pressing it brings the session's center panel forward, the
 * close button closes the panel and the tab. The session keeps running.
 */
export function RoundtableTab() {
  const { t } = useLingui();
  const sessionId = useRoundtableViewStore((state) => state.openSessionId);
  const shown = useRoundtableViewStore(isRoundtablePanelShown);
  const session = useRoundtableSession(sessionId ?? undefined);
  if (!sessionId) return null;

  const title = session?.title ?? t`Roundtable`;
  // A team chat that only waits for a message is not working.
  const tone = session && !isChatIdle(session) ? sessionTone(session.status) : "inactive";
  return (
    <div
      data-vc-tab=""
      data-vc-roundtable-tab=""
      data-selected={shown || undefined}
      className="vc-tab vc-tab--roundtable group relative flex min-w-0 shrink-0 items-center"
    >
      <Button
        render={(buttonProps) => (
          <button {...buttonProps} type="button" role="tab" aria-selected={shown} title={title} />
        )}
        variant="ghost"
        size="sm"
        aria-label={t`Roundtable: ${title}`}
        className="vc-tab__main flex h-full min-w-0 items-center justify-start gap-1.5 rounded-none font-normal"
        onPress={showRoundtablePanel}
      >
        <UsersRound aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="vc-tab__title min-w-0 truncate">{title}</span>
        <span aria-hidden="true" className="vc-tab__dot" data-tone={tone} />
      </Button>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t`Close Roundtable ${title}`}
        excludeFromTabOrder
        className="vc-tab__close min-w-0 shrink-0 p-0"
        onPress={closeRoundtableView}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
