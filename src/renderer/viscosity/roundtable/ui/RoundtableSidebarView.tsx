/**
 * ViscosityCode Roundtable UI: the activity bar's Roundtable sidebar view.
 * Lists the sessions (newest first) with their pattern, status and seats, and
 * offers "New Roundtable". Rows reuse the sidebar's `SidebarButton` pattern;
 * each row's menu deletes its session after a confirmation. A team chat that
 * only waits for a message shows as "Ready", not running.
 */
import { useState, type SyntheticEvent } from "react";
import { Dropdown, Label, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { MoreHorizontal, Plus, Trash2, UsersRound } from "lucide-react";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import type { ActivitySidebarViewProps } from "@/renderer/viscosity/layout/activityBar";
import {
  deleteRoundtable,
  type RoundtableSummary,
  stopRoundtable,
  useRoundtableList,
  useRoundtableSession,
} from "../api";
import { ParticipantAvatarStack } from "./ParticipantAvatar";
import { isChatIdle, PATTERN_LABELS, SESSION_STATUS_LABELS, sessionTone } from "./patterns";
import {
  closeRoundtableView,
  isRoundtablePanelShown,
  openRoundtableSetup,
  openRoundtableView,
  useRoundtableViewStore,
} from "./roundtableViewStore";

function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}

/** Stops a live session first (deleting only forgets it), then forgets it and closes its tab. */
async function removeRoundtable(summary: RoundtableSummary): Promise<void> {
  if (summary.status === "running" || summary.status === "paused") {
    await stopRoundtable(summary.id);
  }
  if (useRoundtableViewStore.getState().openSessionId === summary.id) closeRoundtableView();
  deleteRoundtable(summary.id);
}

function DeleteRoundtableDialog(props: { summary: RoundtableSummary; onClose: () => void }) {
  const { t } = useLingui();
  const title = props.summary.title;
  return (
    <ConfirmDialog
      isOpen
      title={t`Delete ${title}?`}
      body={t`The Roundtable is removed and any replies in progress stop. Its participant threads stay in your sidebar.`}
      confirmLabel={t`Delete Roundtable`}
      onClose={props.onClose}
      onConfirm={() => {
        props.onClose();
        void removeRoundtable(props.summary).catch((error: unknown) =>
          toast.danger(error instanceof Error ? error.message : String(error)),
        );
      }}
    />
  );
}

function RoundtableRowMenu(props: { summary: RoundtableSummary; onDelete: () => void }) {
  const { t } = useLingui();
  const title = props.summary.title;
  const label = t`Roundtable actions for ${title}`;
  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={label}
        className="flex size-6 shrink-0 items-center justify-center rounded-3xl text-muted outline-none hover:bg-[var(--row-hover)] hover:text-foreground focus-visible:focus-ring"
      >
        <MoreHorizontal aria-hidden="true" className="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={label}
          className="poracode-menu min-w-44"
          onAction={(key) => {
            if (key === "delete") props.onDelete();
          }}
        >
          <Dropdown.Item id="delete" textValue={t`Delete Roundtable`} variant="danger">
            <Trash2 aria-hidden="true" className="size-3.5" />
            <Label>
              <Trans>Delete Roundtable</Trans>
            </Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function RoundtableListRow(props: { summary: RoundtableSummary; active: boolean }) {
  const { summary } = props;
  const { i18n, t } = useLingui();
  const session = useRoundtableSession(summary.id);
  const [deleting, setDeleting] = useState(false);
  const idle = session ? isChatIdle(session) : false;
  const status = idle ? t`Ready` : i18n._(SESSION_STATUS_LABELS[summary.status]);
  return (
    <div role="listitem" data-vc-roundtable-row={summary.id}>
      <SidebarButton
        size="xs"
        isActive={props.active}
        isCurrentPage={props.active}
        icon={
          <span
            className="vc-rt-status-dot"
            data-tone={idle ? "inactive" : sessionTone(summary.status)}
          >
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
        suffix={
          <>
            <ParticipantAvatarStack participants={session?.participants ?? []} />
            {/* The menu sits inside the row: its presses must not also open the session. */}
            <span role="presentation" onClick={stopPropagation} onKeyDown={stopPropagation}>
              <RoundtableRowMenu summary={summary} onDelete={() => setDeleting(true)} />
            </span>
          </>
        }
        onPress={() => openRoundtableView(summary.id)}
      />
      {deleting ? (
        <DeleteRoundtableDialog summary={summary} onClose={() => setDeleting(false)} />
      ) : null}
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
              Put two to five of your AIs on the same conversation and let them work together.
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
