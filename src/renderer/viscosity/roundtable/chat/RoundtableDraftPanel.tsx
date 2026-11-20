/**
 * ViscosityCode: the new-thread composer dock shown in Roundtable mode, built
 * from upstream's thread-dock rows (same chrome as the Experiment targets).
 * Seat 0 is the composer's own model; extra participants are added here.
 */
import { Tooltip } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { UsersRound, X } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import {
  ThreadDockActionRow,
  ThreadDockHeader,
  ThreadDockList,
  ThreadDockRow,
  ThreadDockSection,
} from "@/renderer/components/thread/ThreadDockUI";
import { useReadyAgentBrains } from "../api";
import { ParticipantAddMenu, PatternMenu, SeatIcon } from "./ParticipantControls";
import { modelSeatCandidates } from "./participants";
import {
  primarySeatId,
  type RoundtableDraftPrimary,
  type RoundtableDraftState,
} from "./useRoundtableDraft";

export function RoundtableDraftPanel(props: {
  projectId: string;
  primary: RoundtableDraftPrimary;
  draft: RoundtableDraftState;
  isSubmitting: boolean;
}) {
  const { t } = useLingui();
  const { draft, primary } = props;
  const brains = useReadyAgentBrains(props.projectId);
  const candidates = modelSeatCandidates(brains);
  const primaryLabel = primary.modelLabel
    ? `${primary.agentLabel} · ${primary.modelLabel}`
    : primary.agentLabel;
  const total = draft.seats.length + 1;

  return (
    <ThreadDockSection ariaLabel={t`Roundtable`} placement="composer">
      <ThreadDockHeader
        icon={UsersRound}
        title={t`Roundtable`}
        countLabel={<Plural value={total} one="# participant" other="# participants" />}
        actions={
          <div className="flex items-center gap-0.5">
            <PatternMenu
              value={draft.pattern}
              compact
              isDisabled={props.isSubmitting}
              onChange={draft.setPattern}
            />
            <ParticipantAddMenu
              iconOnly
              candidates={candidates}
              excludeIds={[primarySeatId(primary), ...draft.seats.map((seat) => seat.id)]}
              isDisabled={props.isSubmitting || draft.isFull}
              onAdd={draft.addSeat}
            />
            <Tooltip delay={0}>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-0 shrink-0 text-muted"
                  aria-label={t`Leave Roundtable mode`}
                  isDisabled={props.isSubmitting}
                  onPress={() => draft.setEnabled(false)}
                >
                  <X className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <Trans>Leave Roundtable mode</Trans>
              </Tooltip.Content>
            </Tooltip>
          </div>
        }
      />
      <ThreadDockList placement="composer" gap="1">
        <ThreadDockRow title={primaryLabel}>
          <ProviderIcon
            kind={primary.agentKind}
            fallbackLabel={primary.agentLabel}
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate leading-5 text-foreground">{primaryLabel}</span>
          <span className="shrink-0 truncate text-foreground-muted opacity-80">
            <Trans>This composer's model</Trans>
          </span>
        </ThreadDockRow>
        {draft.seats.map((seat) => (
          <ThreadDockActionRow
            key={seat.id}
            title={seat.label}
            action={<X className="size-3" />}
            actionLabel={t`Remove ${seat.label}`}
            actionTitle={t`Remove ${seat.label}`}
            onAction={() => draft.removeSeat(seat.id)}
            isActionDisabled={props.isSubmitting}
          >
            <SeatIcon candidate={seat} />
            <span className="min-w-0 flex-1 truncate leading-5 text-foreground">{seat.label}</span>
            <span className="shrink-0 truncate text-foreground-muted opacity-80">
              {seat.presentationMode === "terminal" ? t`CLI` : t`Chat`}
            </span>
          </ThreadDockActionRow>
        ))}
        {draft.seats.length === 0 ? (
          <ThreadDockRow>
            <span className="min-w-0 flex-1 truncate leading-5 text-[color:var(--muted)]">
              {candidates.length === 0 ? (
                <Trans>No other signed-in models are ready.</Trans>
              ) : (
                <Trans>Add at least one more participant.</Trans>
              )}
            </span>
          </ThreadDockRow>
        ) : null}
      </ThreadDockList>
    </ThreadDockSection>
  );
}
