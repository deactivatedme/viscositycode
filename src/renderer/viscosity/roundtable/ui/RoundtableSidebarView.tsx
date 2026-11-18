/**
 * ViscosityCode Roundtable UI: the activity bar's Roundtable sidebar view.
 * Lists the sessions (newest first) with their pattern, status and seats, and
 * offers "New Roundtable". Rows reuse the sidebar's `SidebarButton` pattern.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, UsersRound } from "lucide-react";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import type { ActivitySidebarViewProps } from "@/renderer/viscosity/layout/activityBar";
import { type RoundtableSummary, useRoundtableList, useRoundtableSession } from "../api";
import { ParticipantAvatarStack } from "./ParticipantAvatar";
import { PATTERN_LABELS, SESSION_STATUS_LABELS, sessionTone } from "./patterns";
import {
  isRoundtablePanelShown,
  openRoundtableSetup,
  openRoundtableView,
  useRoundtableViewStore,
} from "./roundtableViewStore";

function RoundtableListRow(props: { summary: RoundtableSummary; active: boolean }) {
  const { summary } = props;
  const { i18n } = useLingui();
  const session = useRoundtableSession(summary.id);
  const status = i18n._(SESSION_STATUS_LABELS[summary.status]);
  return (
    <div role="listitem" data-vc-roundtable-row={summary.id}>
      <SidebarButton
        size="xs"
        isActive={props.active}
        isCurrentPage={props.active}
        icon={
          <span className="vc-rt-status-dot" data-tone={sessionTone(summary.status)}>
            <span className="sr-only">{status}</span>
          </span>
        }
        label={
          <>
            <span className="vc-rt-list__title">{summary.title}</span>
            <span className="vc-rt-list__meta">
              {i18n._(PATTERN_LABELS[summary.pattern])} · {status}
            </span>
          </>
        }
        suffix={<ParticipantAvatarStack participants={session?.participants ?? []} />}
        onPress={() => openRoundtableView(summary.id)}
      />
    </div>
  );
}

export function RoundtableSidebarView(_props: ActivitySidebarViewProps) {
  const { t } = useLingui();
  const sessions = useRoundtableList();
  const activeSessionId = useRoundtableViewStore((state) =>
    isRoundtablePanelShown(state) ? state.openSessionId : null,
  );
  const ordered = sessions.toSorted((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="vc-rt-list flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pb-1">
        <SidebarButton
          size="xs"
          icon={<Plus aria-hidden="true" className="size-3.5 shrink-0" />}
          label={t`New Roundtable`}
          onPress={() => openRoundtableSetup()}
        />
      </div>
      {ordered.length === 0 ? (
        <div className="vc-rt-list__empty flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <UsersRound aria-hidden="true" className="size-5 text-muted" />
          <p className="text-sm text-foreground">
            <Trans>No roundtables yet</Trans>
          </p>
          <p className="text-xs text-muted">
            <Trans>
              Seat two to five of your agents at one task and let them build, review and debate in
              turns.
            </Trans>
          </p>
        </div>
      ) : (
        <div
          role="list"
          aria-label={t`Roundtables`}
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2"
        >
          {ordered.map((summary) => (
            <RoundtableListRow
              key={summary.id}
              summary={summary}
              active={summary.id === activeSessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
