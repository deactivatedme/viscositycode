/**
 * ViscosityCode Roundtable UI: the bottom bar — Stop, Pause/Resume (Retry on
 * a failed session), one "Open <participant> thread" button per agent seat —
 * and the composer that posts a message (with @participant mentions) through
 * `postToRoundtable`. Once a session has ended the composer is disabled with a
 * short hint, since the engine would reject the message anyway, and offers to
 * continue with the same AIs as a team chat.
 *
 * A team chat ("open", "Work together") has no Pause: "Stop replies" only
 * interrupts the current replies, and the composer stays open (posting to a
 * stopped team chat reopens it).
 */
import { type KeyboardEvent, useId, useState } from "react";
import { Button, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUp, Pause, Play, RotateCcw, Square } from "lucide-react";
import { TextArea } from "@/renderer/components/common/TextArea";
import { useOpenableThreadIds } from "@/renderer/viscosity/layout/tabs/openTabsStore";
import { activateThreadTab } from "@/renderer/viscosity/layout/tabs/tabActions";
import {
  interruptRoundtable,
  pauseRoundtable,
  postToRoundtable,
  resumeRoundtable,
  stopRoundtable,
} from "../api";
import type { RoundtableSession } from "../types";
import { followUpMessage } from "./compareActions";
import { extractMentions, insertMention, mentionHandles, removeMention } from "./mentions";
import { ParticipantAvatar } from "./ParticipantAvatar";
import { isChatIdle } from "./patterns";
import { openRoundtableSetup } from "./roundtableViewStore";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RoundtableControls(props: { session: RoundtableSession }) {
  const { session } = props;
  const { t } = useLingui();
  const [stopping, setStopping] = useState(false);
  const active = session.status === "running" || session.status === "paused";
  const failed = session.status === "failed";
  const open = session.pattern === "open";
  // A team chat stops its current replies only; there is nothing to stop while it waits.
  const canStop = open ? session.status === "running" && !isChatIdle(session) : active;

  async function stop() {
    setStopping(true);
    try {
      await (open ? interruptRoundtable(session.id) : stopRoundtable(session.id));
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setStopping(false);
    }
  }

  function togglePause() {
    try {
      if (session.status === "paused") resumeRoundtable(session.id);
      else pauseRoundtable(session.id);
    } catch (error) {
      toast.danger(errorText(error));
    }
  }

  /** A failed session re-runs its failed turns (the engine's resume). */
  function retry() {
    try {
      resumeRoundtable(session.id);
    } catch (error) {
      toast.danger(errorText(error));
    }
  }

  // A seat whose thread was deleted or archived offers no button (its transcript stays).
  const liveThreadIds = useOpenableThreadIds(Object.values(session.threadIds));
  const seatsWithThreads = session.participants.flatMap((participant) => {
    const threadId = session.threadIds[participant.id];
    return threadId && liveThreadIds.includes(threadId) ? [{ participant, threadId }] : [];
  });

  return (
    <div className="vc-rt-controls" role="toolbar" aria-label={t`Roundtable controls`}>
      <Button
        size="sm"
        variant="danger-soft"
        isDisabled={!canStop}
        isPending={stopping}
        onPress={() => void stop()}
      >
        <Square aria-hidden="true" className="size-3.5" />
        {open ? <Trans>Stop replies</Trans> : <Trans>Stop</Trans>}
      </Button>
      {/* Nothing to pause between messages in a team chat (an old paused one can still resume). */}
      {open && !failed && session.status !== "paused" ? null : failed ? (
        <Button size="sm" variant="secondary" onPress={retry}>
          <RotateCcw aria-hidden="true" className="size-3.5" />
          <Trans>Retry</Trans>
        </Button>
      ) : (
        <Button size="sm" variant="secondary" isDisabled={!active} onPress={togglePause}>
          {session.status === "paused" ? (
            <>
              <Play aria-hidden="true" className="size-3.5" />
              <Trans>Resume</Trans>
            </>
          ) : (
            <>
              <Pause aria-hidden="true" className="size-3.5" />
              <Trans>Pause</Trans>
            </>
          )}
        </Button>
      )}
      {seatsWithThreads.length > 0 ? (
        <span aria-hidden="true" className="vc-rt-controls__divider" />
      ) : null}
      {seatsWithThreads.map(({ participant, threadId }) => {
        const name = participant.label;
        return (
          <Button
            key={participant.id}
            size="sm"
            variant="ghost"
            className="vc-rt-controls__thread"
            onPress={() => activateThreadTab(threadId)}
          >
            <ParticipantAvatar participant={participant} size="sm" />
            <span className="truncate">{t`Open ${name} thread`}</span>
          </Button>
        );
      })}
    </div>
  );
}

export function RoundtableComposer(props: { session: RoundtableSession }) {
  const { session } = props;
  const { t } = useLingui();
  const hintId = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const open = session.pattern === "open";
  const handles = mentionHandles(session.participants);
  const mentioned = open ? extractMentions(text, handles) : [];
  // An ended session takes no messages (nobody would answer): say why instead.
  // A stopped team chat still does: posting reopens it.
  const endedHint =
    open && session.status === "stopped"
      ? null
      : session.status === "failed"
        ? t`This Roundtable failed. Retry it to continue.`
        : session.status === "stopped"
          ? t`This Roundtable was stopped. Start a new one to continue.`
          : session.status === "done"
            ? t`This Roundtable is finished. Start a new one to continue.`
            : null;
  const ended = endedHint !== null;
  const canFollowUp = session.status === "done" || session.status === "stopped";
  const canSend = !ended && text.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    const body = text.trim();
    const mentions = open ? extractMentions(body, handles) : [];
    setSending(true);
    try {
      await postToRoundtable(session.id, body, mentions.length > 0 ? { mentions } : undefined);
      setText("");
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  return (
    <div className="vc-rt-composer" data-ended={ended || undefined}>
      {endedHint ? (
        <div className="rt-view-ended">
          <p id={hintId} role="status" className="vc-rt-composer__hint">
            {endedHint}
          </p>
          {canFollowUp ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() =>
                openRoundtableSetup({
                  projectId: session.projectId,
                  pattern: "open",
                  participants: session.participants,
                  title: session.title,
                  task: followUpMessage(session),
                })
              }
            >
              <Trans>Continue as a team chat</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* @mentions choose who answers only in a team chat; elsewhere they do nothing. */}
      {open ? (
        <div
          className="vc-rt-composer__mentions"
          role="group"
          aria-label={t`Mention a participant`}
        >
          {session.participants.map((participant) => {
            const handle = handles.get(participant.id) ?? participant.id;
            const selected = mentioned.includes(participant.id);
            const name = participant.label;
            return (
              <Button
                key={participant.id}
                size="sm"
                variant="ghost"
                aria-pressed={selected}
                aria-label={t`Mention ${name}`}
                data-selected={selected || undefined}
                className="vc-rt-mention"
                isDisabled={ended}
                onPress={() =>
                  setText((current) =>
                    selected
                      ? removeMention(current, handle, handles)
                      : insertMention(current, handle),
                  )
                }
              >
                <ParticipantAvatar participant={participant} size="sm" />
                <span className="truncate">@{handle}</span>
              </Button>
            );
          })}
        </div>
      ) : null}
      <div className="vc-rt-composer__row">
        <TextArea
          autoSize
          maxRows={6}
          rows={1}
          aria-label={t`Message the Roundtable`}
          placeholder={
            open
              ? t`Message the team. Everyone answers in turn; @mention to ask someone specific.`
              : t`Add guidance for the next turn.`
          }
          className="vc-rt-composer__input min-w-0 flex-1"
          disabled={ended}
          {...(ended ? { "aria-describedby": hintId } : {})}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={t`Send`}
          isDisabled={!canSend}
          isPending={sending}
          onPress={() => void send()}
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </div>
  );
}
