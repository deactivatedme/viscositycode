/**
 * ViscosityCode: start a Roundtable from an in-chat entry point.
 *
 * In the open pattern the engine treats `task` as the topic and replies only
 * to posted messages, so a group chat started with a task posts that task as
 * its first message (no mentions: everyone answers, in seat order). The other
 * patterns start working on the task by themselves.
 *
 * An open chat started from a chat is linked to it, so the chat's later
 * @mentions go to this Roundtable instead of starting a second one.
 */
import { postToRoundtable, startRoundtable, type StartRoundtableInput } from "../api";
import { setRoundtableChatLink } from "./chatLinksStore";

/** Links a started open Roundtable to the chat it came from (`originThreadId`). */
export function linkRoundtableToOriginChat(input: StartRoundtableInput, sessionId: string): void {
  if (input.pattern !== "open" || !input.originThreadId) return;
  setRoundtableChatLink(input.originThreadId, {
    sessionId,
    participants: [...input.participants],
    updatedAt: Date.now(),
  });
}

export async function startRoundtableFromChat(input: StartRoundtableInput): Promise<string> {
  const sessionId = await startRoundtable(input);
  // Linked before the first post, so a refused post still leaves the chat linked.
  linkRoundtableToOriginChat(input, sessionId);
  const firstMessage = input.task.trim();
  if (input.pattern === "open" && firstMessage) await postToRoundtable(sessionId, firstMessage);
  return sessionId;
}
