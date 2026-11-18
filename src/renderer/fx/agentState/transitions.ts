/**
 * ViscosityCode: one-shot agent transitions published by the agent-state
 * monitor (Step 5), for listeners that react to a change rather than draw a
 * state — the sound pack today.
 *
 * - `done`: an active turn settled to idle/finished without error or a stop.
 * - `error`: the thread entered an error, or its turn was cut off by one.
 * - `attention`: the thread started waiting for an approval or a reply.
 *
 * The monitor follows every turn-active thread, so background threads are
 * covered too. A thread is never reported for the state it already had when
 * the monitor first saw it, so start-up and newly opened tabs stay quiet.
 * Listeners run synchronously inside a store subscription: they must be cheap
 * and must not write to the app store.
 *
 * Like the host's notification classifier, waiting on the user wins over
 * finishing: a turn that settles with an open question or approval is
 * reported as `attention`, never as `done`.
 */
import type { ThreadAttention, ThreadStatus } from "@/shared/contracts";
import { threadAttentionStatus } from "@/shared/threadAttention";

export const AGENT_FX_TRANSITION_KINDS = ["done", "error", "attention"] as const;
export type AgentFxTransitionKind = (typeof AGENT_FX_TRANSITION_KINDS)[number];

export interface AgentFxTransition {
  readonly threadId: string;
  readonly kind: AgentFxTransitionKind;
}

export type AgentFxTransitionListener = (transition: AgentFxTransition) => void;

/** The thread waits for the user's approval or reply, whatever its run status says. */
export function isWaitingOnUser(thread: {
  readonly status: ThreadStatus;
  readonly attention?: ThreadAttention | undefined;
}): boolean {
  const display = threadAttentionStatus(thread.status, thread.attention);
  return display === "needs_approval" || display === "needs_reply";
}

const listeners = new Set<AgentFxTransitionListener>();

/** Listen for agent transitions; returns the unsubscribe. */
export function onAgentFxTransition(listener: AgentFxTransitionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish one transition. A failing listener never stops the others or the monitor. */
export function emitAgentFxTransition(transition: AgentFxTransition): void {
  for (const listener of [...listeners]) {
    try {
      listener(transition);
    } catch (error) {
      if (import.meta.env.DEV) console.warn("[viscosity-fx] transition listener failed", error);
    }
  }
}
