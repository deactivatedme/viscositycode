import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeContextManagedModelId } from "./contextWindow";

const namedRelease = /^claude-[a-z]+-\d+(?:-\d+)*(?:-\d{8})?$/u;

/** Compare concrete Anthropic releases. Aliases and gateway-specific IDs are opaque. */
export function claudeModelRouteError(requested: string, observed: string): string | undefined {
  const expected = claudeContextManagedModelId(requested);
  const actual = claudeContextManagedModelId(observed);
  if (!expected || !actual || !namedRelease.test(expected) || !namedRelease.test(actual)) return;
  if (expected === actual) return;
  // Legacy unversioned aliases can resolve to their own dated snapshot.
  if (!/-\d{8}$/u.test(expected) && actual.replace(/-\d{8}$/u, "") === expected) return;
  return `Claude reported ${actual} for the selected model ${expected}. The turn was stopped.`;
}

export function readClaudeReplyModel(message: SDKMessage): string | undefined {
  if (message.type === "assistant" && !message.error) return message.message.model;
  if (message.type === "stream_event" && message.event.type === "message_start")
    return message.event.message.model;
  return undefined;
}
