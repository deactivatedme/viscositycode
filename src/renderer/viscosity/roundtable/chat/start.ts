/**
 * ViscosityCode: start a Roundtable from an in-chat entry point.
 *
 * In the open pattern the engine treats `task` as the topic and replies only
 * to posted messages, so a group chat started with a task posts that task as
 * its first message (no mentions: everyone answers, in seat order). The other
 * patterns start working on the task by themselves.
 */
import { postToRoundtable, startRoundtable, type StartRoundtableInput } from "../api";

export async function startRoundtableFromChat(input: StartRoundtableInput): Promise<string> {
  const sessionId = await startRoundtable(input);
  const firstMessage = input.task.trim();
  if (input.pattern === "open" && firstMessage) await postToRoundtable(sessionId, firstMessage);
  return sessionId;
}
