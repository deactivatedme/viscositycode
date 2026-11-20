/**
 * ViscosityCode Roundtable UI: the session header — title, pattern and status
 * chips, and one chip per participant (avatar, name, role, model, live state
 * in the fx state colours, provider usage meter, playbook), and "Instructions", which
 * edits the shared and per-AI instructions. A team chat ("open") shows no
 * roles, and "Ready" while it only waits for a message.
 */
import { useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ScrollText, UsersRound, X } from "lucide-react";
import type { AgentStatus, ThreadStatus } from "@/shared/contracts";
import { type SavedPlaybook, threadPlaybookBinding } from "@/shared/viscosity/playbook";
import { ProviderUsageCircle } from "@/renderer/components/providers/ProviderUsageCircle";
import { resolveModelLabel } from "@/renderer/components/providers/modelDisplay";
import { useHostProviderUsage } from "@/renderer/components/providers/useHostProviderUsage";
import { useHostAgentStatuses } from "@/renderer/hooks/useHostAgentStatuses";
import { useAppStore } from "@/renderer/state/appStore";
import { getThreadMap, useProject } from "@/renderer/state/useThread";
import { resolveSeatPlaybook, useRoundtablePlaybookCatalog } from "../playbooks";
import type { ParticipantProfile, RoundtableSession, TurnStatus } from "../types";
import { ParticipantAvatar } from "./ParticipantAvatar";
import {
  isChatIdle,
  latestTurnOf,
  type ParticipantFxState,
  PATTERN_LABELS,
  patternIsAnswerOnly,
  ROLE_LABELS,
  SESSION_STATUS_LABELS,
  sessionTone,
  turnFxState,
} from "./patterns";
import { RoundtableInstructionsDialog } from "./RoundtableInstructionsDialog";
import { closeRoundtableView } from "./roundtableViewStore";

/**
 * A participant's live state: its Roundtable turn first, then its thread (a
 * thread can need the user even between turns, e.g. a question after a turn).
 */
export function participantFxState(
  turnStatus: TurnStatus | undefined,
  threadStatus: ThreadStatus | undefined,
): ParticipantFxState {
  const fromTurn = turnFxState(turnStatus);
  if (fromTurn === "attention") return fromTurn;
  if (threadStatus === "needs_approval" || threadStatus === "needs_reply") return "attention";
  if (fromTurn !== "idle") return fromTurn;
  if (threadStatus === "error") return "error";
  if (threadStatus === "working" || threadStatus === "launching") return "working";
  return "idle";
}

function ParticipantUsage(props: {
  remoteServerId: string | undefined;
  agentKind: string;
  agentInstanceId: string | undefined;
}) {
  const { t } = useLingui();
  const { snapshot, label } = useHostProviderUsage(props.remoteServerId, {
    kind: props.agentKind,
    instanceId: props.agentInstanceId,
  });
  const windows = snapshot?.status === "ok" ? snapshot.windows : undefined;
  if (!windows || windows.length === 0) return null;
  const used = Math.round(Math.max(...windows.map((window) => window.usedPercent)));
  const description = t`${label} usage: ${used}% of the tightest limit used`;
  return (
    <span className="vc-rt-participant__usage" title={description}>
      <ProviderUsageCircle
        kind={props.agentKind}
        windows={windows}
        size={18}
        showProviderIcon={false}
      />
      <span className="sr-only">{description}</span>
    </span>
  );
}

function ParticipantChip(props: {
  participant: ParticipantProfile;
  session: RoundtableSession;
  agentStatuses: readonly AgentStatus[];
  remoteServerId: string | undefined;
  playbooks: readonly SavedPlaybook[];
}) {
  const { participant, session } = props;
  const { i18n } = useLingui();
  const threadId = session.threadIds[participant.id];
  const threadStatus = useAppStore((state) =>
    threadId ? getThreadMap(state.threads).get(threadId)?.status : undefined,
  );
  // A seat with a thread shows what that thread is bound to (it may have been switched there).
  const boundPlaybook = useAppStore((state) =>
    threadId
      ? (threadPlaybookBinding(getThreadMap(state.threads).get(threadId)?.config)?.label ?? null)
      : undefined,
  );
  const playbookLabel =
    boundPlaybook === undefined
      ? resolveSeatPlaybook(session, participant, props.playbooks)?.label
      : (boundPlaybook ?? undefined);
  const fxState = participantFxState(
    latestTurnOf(session.turns, participant.id)?.status,
    threadStatus,
  );
  const brain = participant.brain;
  const modelLabel =
    brain.kind === "agent"
      ? (resolveModelLabel(
          props.agentStatuses.find((agent) => agent.kind === brain.agentKind),
          brain.model,
        ) ?? brain.model)
      : brain.model;
  // A team chat has no roles: the chip names the model only.
  const meta = [
    ...(session.pattern === "open" ? [] : [i18n._(ROLE_LABELS[participant.role])]),
    modelLabel,
    ...(playbookLabel ? [playbookLabel] : []),
  ].join(" · ");
  return (
    <div
      role="listitem"
      className="vc-rt-participant"
      data-vc-rt-participant={participant.id}
      data-vc-fx-state={fxState}
      title={`${participant.label} · ${meta}`}
    >
      <span className="vc-rt-participant__avatar">
        <ParticipantAvatar participant={participant} />
        <span aria-hidden="true" className="vc-rt-participant__dot" />
      </span>
      <span className="vc-rt-participant__text">
        <span className="vc-rt-participant__name">{participant.label}</span>
        <span className="vc-rt-participant__meta">{meta}</span>
      </span>
      {brain.kind === "agent" ? (
        <ParticipantUsage
          remoteServerId={props.remoteServerId}
          agentKind={brain.agentKind}
          agentInstanceId={brain.agentInstanceId}
        />
      ) : null}
    </div>
  );
}

export function RoundtableHeader(props: { session: RoundtableSession }) {
  const { session } = props;
  const { i18n, t } = useLingui();
  const project = useProject(session.projectId);
  const agentStatuses = useHostAgentStatuses(project?.remoteServerId, project?.location, {
    installedOnly: true,
  });
  const playbooks = useRoundtablePlaybookCatalog();
  const [editingInstructions, setEditingInstructions] = useState(false);
  const closeLabel = t`Close Roundtable`;
  const instructionsLabel = t`Instructions`;
  const idle = isChatIdle(session);
  return (
    <header className="vc-rt-header">
      <div className="vc-rt-header__top">
        <UsersRound aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <h2 className="vc-rt-header__title" title={session.title}>
          {session.title}
        </h2>
        <span className="vc-rt-pill" data-kind="pattern">
          {i18n._(PATTERN_LABELS[session.pattern])}
        </span>
        <span className="vc-rt-pill" data-tone={idle ? "inactive" : sessionTone(session.status)}>
          {idle ? t`Ready` : i18n._(SESSION_STATUS_LABELS[session.status])}
        </span>
        <span aria-hidden="true" className="min-w-0 flex-1" />
        {/* Everyone answers a comparison once: there is no next reply to instruct. */}
        {patternIsAnswerOnly(session.pattern) ? null : (
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={instructionsLabel}
                className="size-6 min-w-0 text-muted hover:text-foreground"
                onPress={() => setEditingInstructions(true)}
              >
                <ScrollText className="size-3.5" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="bottom">{instructionsLabel}</Tooltip.Content>
          </Tooltip>
        )}
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={closeLabel}
              className="size-6 min-w-0 text-muted hover:text-foreground"
              onPress={closeRoundtableView}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="bottom">{closeLabel}</Tooltip.Content>
        </Tooltip>
      </div>
      <div role="list" aria-label={t`Participants`} className="vc-rt-header__participants">
        {session.participants.map((participant) => (
          <ParticipantChip
            key={participant.id}
            participant={participant}
            session={session}
            agentStatuses={agentStatuses}
            remoteServerId={project?.remoteServerId}
            playbooks={playbooks}
          />
        ))}
      </div>
      {editingInstructions ? (
        <RoundtableInstructionsDialog
          session={session}
          onClose={() => setEditingInstructions(false)}
        />
      ) : null}
    </header>
  );
}
