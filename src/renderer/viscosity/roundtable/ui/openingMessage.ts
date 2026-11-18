/**
 * ViscosityCode Roundtable UI: the first message of an open-pattern
 * Roundtable.
 *
 * The open pattern waits for user messages, so a group chat started from the
 * setup dialog (its task) or from Bots (its first message) posts that text
 * right after the start: the participants answer at once instead of sitting
 * idle. Its @mentions pick who replies, exactly like the composer. Empty text
 * posts nothing.
 */
import { postToRoundtable } from "../api";
import type { ParticipantProfile } from "../types";
import { extractMentions, mentionHandles } from "./mentions";

/**
 * Posts `text` to the just-started session. `participants` are the seats in
 * the order they were started with (the session keeps their ids and order),
 * so the handles match the composer's. Rejects like `postToRoundtable`.
 */
export async function postOpeningMessage(
  sessionId: string,
  text: string,
  participants: readonly Pick<ParticipantProfile, "id" | "label">[],
): Promise<void> {
  const message = text.trim();
  if (!message) return;
  const mentions = extractMentions(message, mentionHandles(participants));
  await postToRoundtable(sessionId, message, mentions.length > 0 ? { mentions } : undefined);
}
