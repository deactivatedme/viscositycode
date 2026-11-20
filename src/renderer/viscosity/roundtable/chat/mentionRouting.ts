/**
 * ViscosityCode: route a chat message that `@mentions` models into an
 * open-pattern Roundtable with the chat as its origin.
 *
 * The first such message starts the Roundtable (the chat's own agent holds
 * seat 0, which the engine binds to the chat thread; the mentioned
 * participants join) and every later one reuses it through the per-chat link;
 * someone mentioned for the first time joins that Roundtable.
 * The message itself is always delivered with `postToRoundtable(…, { mentions })`:
 * in the open pattern only posted messages get replies, and only from the
 * participants they mention. Only engine calls from `../api` are used; the
 * engine launches any new threads.
 */
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { addRoundtableParticipants, postToRoundtable, startRoundtable } from "../api";
import { RoundtableInputError } from "../engine/session";
import type { ParticipantProfile } from "../types";
import {
  forgetRoundtableChatLink,
  getRoundtableChatLink,
  isReusableRoundtable,
  setRoundtableChatLink,
} from "./chatLinksStore";
import type { RoundtableMentionTarget } from "./mentions";
import { candidateToProfile, originParticipantProfile, type OriginChat } from "./participants";
import { MAX_ROUNDTABLE_PARTICIPANTS } from "./patterns";

export interface MentionedRoundtableMessage {
  origin: OriginChat;
  projectId: string;
  text: string;
  mentioned: readonly RoundtableMentionTarget[];
  /** Every mention target the composer offers (labels the origin seat). */
  targets: readonly RoundtableMentionTarget[];
}

export interface MentionedRoundtableResult {
  sessionId: string;
  /** True when this message started a new Roundtable. */
  created: boolean;
}

function mergeSeats(...groups: ReadonlyArray<readonly ParticipantProfile[]>): ParticipantProfile[] {
  const merged: ParticipantProfile[] = [];
  for (const profile of groups.flat()) {
    if (!merged.some((existing) => existing.id === profile.id)) merged.push(profile);
  }
  return merged;
}

export async function postMentionedRoundtableMessage(
  message: MentionedRoundtableMessage,
  now: () => number = Date.now,
): Promise<MentionedRoundtableResult> {
  const threadId = message.origin.id;
  const mentionIds = [...new Set(message.mentioned.map((target) => target.id))];
  const mentionedSeats = message.mentioned.map((target) =>
    candidateToProfile(target.candidate, "member"),
  );
  const linked = getRoundtableChatLink(threadId);
  const reusable = linked && isReusableRoundtable(linked.sessionId) ? linked : undefined;
  if (linked && !reusable) forgetRoundtableChatLink(threadId);

  if (reusable) {
    // Someone new joins the chat's Roundtable (ViscosityCode: Work together),
    // so everyone keeps their thread and context.
    const participants = mergeSeats(reusable.participants, mentionedSeats);
    assertSeatLimit(participants);
    const joining = participants.slice(reusable.participants.length);
    try {
      if (joining.length > 0) await addRoundtableParticipants(reusable.sessionId, joining);
      await postToRoundtable(reusable.sessionId, message.text, { mentions: mentionIds });
      setRoundtableChatLink(threadId, { ...reusable, participants, updatedAt: now() });
      return { sessionId: reusable.sessionId, created: false };
    } catch (error) {
      // Who cannot join (seat limit, missing model) is the user's to fix; a
      // fresh session would leave this one running beside it.
      if (error instanceof RoundtableInputError) throw error;
      // The linked session is gone or has ended (the
      // engine rejects such posts). Start a fresh one below so this message
      // is not lost.
      forgetRoundtableChatLink(threadId);
    }
  }

  // No Roundtable yet: seat the chat's own agent first (with its current
  // model), then everyone mentioned, in a new open Roundtable.
  const origin = originParticipantProfile(
    message.origin,
    message.targets.map((target) => target.candidate),
    "member",
  );
  const participants = mergeSeats([origin], mentionedSeats);
  assertSeatLimit(participants);
  const sessionId = await startRoundtable({
    task: message.text,
    pattern: "open",
    projectId: message.projectId,
    participants,
    originThreadId: threadId,
    worktree: { mode: "current" },
  });
  setRoundtableChatLink(threadId, { sessionId, participants, updatedAt: now() });
  await postToRoundtable(sessionId, message.text, { mentions: mentionIds });
  return { sessionId, created: true };
}

function assertSeatLimit(participants: readonly ParticipantProfile[]): void {
  if (participants.length > MAX_ROUNDTABLE_PARTICIPANTS) {
    throw new Error(
      i18n._(
        msg`A Roundtable seats up to ${MAX_ROUNDTABLE_PARTICIPANTS} participants, this chat included. Mention someone already seated, or start another chat.`,
      ),
    );
  }
}
