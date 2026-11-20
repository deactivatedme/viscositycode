/**
 * ViscosityCode: the compact "seat a Roundtable" dialog behind `/roundtable`
 * and the "New Roundtable…" / "Invite another model into this chat…" palette
 * commands. Picks participants (ready models) and a pattern, then
 * calls the engine's `startRoundtable`. It never navigates: the user stays on
 * the chat they were in, and the engine owns where the Roundtable shows up.
 */
import { useState } from "react";
import { Label, Modal, TextField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { friendlyError } from "@/shared/messages";
import { Button } from "@/renderer/components/common/Button";
import { TextArea } from "@/renderer/components/common/TextArea";
import { useThread } from "@/renderer/state/useThread";
import { useReadyAgentBrains } from "../api";
import type { RoundtablePattern } from "../types";
import { closeRoundtableInvite, type RoundtableInviteRequest } from "./inviteStore";
import { startRoundtableFromChat } from "./start";
import { toastRoundtableStarted } from "./startedToast";
import { ParticipantAddMenu, PatternMenu, SeatIcon } from "./ParticipantControls";
import {
  invitedSeatProfiles,
  modelSeatCandidates,
  seatProfiles,
  type OriginChat,
  type SeatCandidate,
} from "./participants";
import {
  DEFAULT_ROUNDTABLE_PATTERN,
  MAX_ROUNDTABLE_PARTICIPANTS,
  MIN_ROUNDTABLE_PARTICIPANTS,
} from "./patterns";

/** How many seats the dialog picks: the origin chat already holds one when inviting. */
export function inviteSeatLimits(kind: RoundtableInviteRequest["kind"]): {
  min: number;
  max: number;
} {
  const origin = kind === "invite" ? 1 : 0;
  return {
    min: MIN_ROUNDTABLE_PARTICIPANTS - origin,
    max: MAX_ROUNDTABLE_PARTICIPANTS - origin,
  };
}

export function RoundtableInviteDialog(props: { request: RoundtableInviteRequest }) {
  const { request } = props;
  const { t } = useLingui();
  const brains = useReadyAgentBrains(request.projectId);
  const originThread = useThread(request.kind === "invite" ? request.originThreadId : undefined);
  // The engine binds the origin chat to seat 0, so its own agent and model sit first.
  const origin: OriginChat | undefined = originThread
    ? {
        id: originThread.id,
        title: originThread.title,
        agentKind: originThread.agentKind,
        model: originThread.config.model,
        presentationMode: originThread.presentationMode ?? "terminal",
      }
    : undefined;
  const originTitle = originThread?.title.trim();
  const [task, setTask] = useState(request.task);
  const [instructions, setInstructions] = useState("");
  const [pattern, setPattern] = useState<RoundtablePattern>(DEFAULT_ROUNDTABLE_PATTERN);
  const [seats, setSeats] = useState<SeatCandidate[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const limits = inviteSeatLimits(request.kind);
  const candidates = modelSeatCandidates(brains);
  const canStart =
    !pending &&
    (request.kind === "new" || origin !== undefined) &&
    // An open chat can start empty and wait for the first message.
    (pattern === "open" || task.trim().length > 0) &&
    seats.length >= limits.min &&
    seats.length <= limits.max;

  function close() {
    if (!pending) closeRoundtableInvite();
  }

  async function start() {
    if (!canStart) return;
    setPending(true);
    setError(undefined);
    const shared = instructions.trim();
    try {
      const sessionId = await startRoundtableFromChat({
        task: task.trim(),
        pattern,
        projectId: request.projectId,
        participants: origin
          ? invitedSeatProfiles(pattern, origin, candidates, seats)
          : seatProfiles(pattern, seats),
        worktree: { mode: "current" },
        ...(request.kind === "invite" ? { originThreadId: request.originThreadId } : {}),
        ...(shared ? { instructions: shared } : {}),
      });
      request.onStarted?.();
      closeRoundtableInvite();
      toastRoundtableStarted(sessionId);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && close()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[460px]" data-vc-roundtable-invite="">
          <Modal.CloseTrigger isDisabled={pending} />
          <Modal.Header>
            <Modal.Heading>
              {request.kind === "invite" ? (
                <Trans>Invite models into this chat</Trans>
              ) : (
                <Trans>New Roundtable</Trans>
              )}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3 p-4">
            <p className="text-sm text-muted">
              {request.kind === "invite" ? (
                <Trans>
                  This chat keeps its seat. Pick 1–4 more participants and how you all work
                  together. Approvals still come to you.
                </Trans>
              ) : (
                <Trans>
                  Pick 2–5 participants and how they work together. Approvals still come to you.
                </Trans>
              )}
            </p>
            {originTitle ? (
              <p className="truncate text-xs text-muted">
                <Trans>From chat: {originTitle}</Trans>
              </p>
            ) : null}
            <TextField value={task} onChange={setTask} isDisabled={pending}>
              <Label>
                {pattern === "open" ? <Trans>First message (optional)</Trans> : <Trans>Task</Trans>}
              </Label>
              <TextArea autoSize maxRows={6} rows={3} placeholder={t`What should they work on?`} />
            </TextField>
            <TextField value={instructions} onChange={setInstructions} isDisabled={pending}>
              <Label>
                <Trans>Instructions for everyone</Trans>
              </Label>
              <TextArea
                autoSize
                maxRows={6}
                rows={2}
                placeholder={t`Context, rules or goals every AI should follow. You can change these later.`}
              />
            </TextField>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                <Trans>Pattern</Trans>
              </span>
              <PatternMenu value={pattern} isDisabled={pending} onChange={setPattern} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  <Trans>Participants</Trans>
                </span>
                <ParticipantAddMenu
                  candidates={candidates}
                  excludeIds={seats.map((seat) => seat.id)}
                  isDisabled={pending || seats.length >= limits.max}
                  onAdd={(candidate) =>
                    setSeats((current) =>
                      current.some((seat) => seat.id === candidate.id) ||
                      current.length >= limits.max
                        ? current
                        : [...current, candidate],
                    )
                  }
                />
              </div>
              {candidates.length === 0 ? (
                <p className="text-xs text-muted">
                  <Trans>
                    No signed-in models are ready. Install or sign in to a provider first.
                  </Trans>
                </p>
              ) : seats.length === 0 ? (
                <p className="text-xs text-muted">
                  <Trans>No participants yet.</Trans>
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5" aria-label={t`Participants`}>
                  {seats.map((seat) => (
                    <li
                      key={seat.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-foreground/5"
                    >
                      <SeatIcon candidate={seat} />
                      <span className="min-w-0 flex-1 truncate">{seat.label}</span>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        className="size-6 min-w-0 text-muted"
                        aria-label={t`Remove ${seat.label}`}
                        isDisabled={pending}
                        onPress={() =>
                          setSeats((current) => current.filter((entry) => entry.id !== seat.id))
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted" isDisabled={pending}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="tertiary"
              isPending={pending}
              isDisabled={!canStart}
              onPress={() => void start()}
            >
              <Trans>Start Roundtable</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
