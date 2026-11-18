/** Test fixtures for the Roundtable UI (not imported by production code). */
import type { ReadyAgentBrain, RoundtableSummary } from "../api";
import type { ParticipantProfile, RoundtableSession, RoundtableTurn } from "../types";

export function participant(
  id: string,
  overrides: Partial<ParticipantProfile> = {},
): ParticipantProfile {
  return {
    id,
    label: `Agent ${id.toUpperCase()}`,
    role: "member",
    brain: {
      kind: "agent",
      agentKind: `kind-${id}`,
      model: `model-${id}`,
      presentationMode: "gui",
    },
    ...overrides,
  };
}

export function turn(id: string, overrides: Partial<RoundtableTurn> = {}): RoundtableTurn {
  return {
    id,
    participantId: "a",
    round: 1,
    prompt: `Prompt for ${id}`,
    status: "done",
    ...overrides,
  };
}

export function session(overrides: Partial<RoundtableSession> = {}): RoundtableSession {
  return {
    id: "rt1",
    version: 1,
    title: "Fix the login bug",
    task: "Find and fix the login redirect loop.",
    pattern: "build-review",
    projectId: "p1",
    participants: [participant("a", { role: "builder" }), participant("b", { role: "reviewer" })],
    threadIds: {},
    maxRounds: 4,
    status: "running",
    turns: [],
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

export function summaryOf(value: RoundtableSession): RoundtableSummary {
  return {
    id: value.id,
    title: value.title,
    pattern: value.pattern,
    status: value.status,
    participantCount: value.participants.length,
    updatedAt: value.updatedAt,
  };
}

export function readyBrain(
  kind: string,
  overrides: Partial<ReadyAgentBrain> = {},
): ReadyAgentBrain {
  return {
    agentKind: kind,
    label: `Provider ${kind}`,
    models: [
      { id: `${kind}-m1`, label: `${kind} One` },
      { id: `${kind}-m2`, label: `${kind} Two` },
    ],
    defaultModel: `${kind}-m1`,
    presentationModes: ["gui", "terminal"],
    ...overrides,
  };
}
