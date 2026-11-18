/**
 * ViscosityCode Roundtable UI: the bottom bar — Stop, Pause/Resume, one
 * "Open <participant> thread" button per agent seat — and the composer that
 * posts a message (with @participant mentions) through `postToRoundtable`.
 */
import { type KeyboardEvent, useState } from "react";
import { Button, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUp, Pause, Play, Square } from "lucide-react";
import { TextArea } from "@/renderer/components/common/TextArea";
import { activateThreadTab } from "@/renderer/viscosity/layout/tabs/tabActions";
import { pauseRoundtable, postToRoundtable, resumeRoundtable, stopRoundtable } from "../api";
import type { RoundtableSession } from "../types";
import { extractMentions, insertMention, mentionHandles, removeMention } from "./mentions";
import { ParticipantAvatar } from "./ParticipantAvatar";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RoundtableControls(props: { session: RoundtableSession }) {
  const { session } = props;
  const { t } = useLingui();
  const [stopping, setStopping] = useState(false);
  const active = session.status === "running" || session.status === "paused";

  async function stop() {
    setStopping(true);
    try {
      await stopRoundtable(session.id);
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

  const seatsWithThreads = session.participants.flatMap((participant) => {
    const threadId = session.threadIds[participant.id];
    return threadId ? [{ participant, threadId }] : [];
  });

  return (
    <div className="vc-rt-controls" role="toolbar" aria-label={t`Roundtable controls`}>
      <Button
        size="sm"
        variant="danger-soft"
        isDisabled={!active}
        isPending={stopping}
        onPress={() => void stop()}
      >
        <Square aria-hidden="true" className="size-3.5" />
        <Trans>Stop</Trans>
      </Button>
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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const handles = mentionHandles(session.participants);
  const mentioned = extractMentions(text, handles);
  const canSend = text.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    const body = text.trim();
    const mentions = extractMentions(body, handles);
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
    <div className="vc-rt-composer">
      <div className="vc-rt-composer__mentions" role="group" aria-label={t`Mention a participant`}>
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
              onPress={() =>
                setText((current) =>
                  selected ? removeMention(current, handle) : insertMention(current, handle),
                )
              }
            >
              <ParticipantAvatar participant={participant} size="sm" />
              <span className="truncate">@{handle}</span>
            </Button>
          );
        })}
      </div>
      <div className="vc-rt-composer__row">
        <TextArea
          autoSize
          maxRows={6}
          rows={1}
          aria-label={t`Message the Roundtable`}
          placeholder={t`Message the Roundtable. @mention who should answer.`}
          className="vc-rt-composer__input min-w-0 flex-1"
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
