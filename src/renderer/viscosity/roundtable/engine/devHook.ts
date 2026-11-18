/**
 * ViscosityCode Roundtable engine: DEV-only inspection hook.
 *
 *   window.__viscosityRoundtable.sessions()
 *   window.__viscosityRoundtable.simulate()                       // finished build ↔ review demo
 *   window.__viscosityRoundtable.simulate("demo-1", "debate")     // a given id and pattern
 *
 * `simulate` only seeds a finished demo session (fake turns, no threads) into
 * the Roundtable store, for screenshots in mock mode where no agents run.
 */
import type {
  ParticipantProfile,
  RoundtablePattern,
  RoundtableSession,
  RoundtableTurn,
  RoundtableTurnPhase,
} from "../types";

export interface RoundtableDevHook {
  sessions(): RoundtableSession[];
  simulate(sessionId?: string, pattern?: RoundtablePattern): string;
}

export function installRoundtableDevHook(hook: RoundtableDevHook, target?: object): () => void {
  if (!import.meta.env.DEV) return () => {};
  const host = (target ?? (typeof window === "undefined" ? undefined : window)) as
    | { __viscosityRoundtable?: RoundtableDevHook }
    | undefined;
  if (!host) return () => {};
  host.__viscosityRoundtable = hook;
  return () => {
    if (host.__viscosityRoundtable === hook) delete host.__viscosityRoundtable;
  };
}

/** A seat for the demo; the caller passes real agent kinds/labels when it has them. */
export interface DemoSeat {
  agentKind: string;
  label: string;
  model: string;
}

const FALLBACK_SEATS: readonly DemoSeat[] = [
  { agentKind: "demo-agent-a", label: "Agent A", model: "demo-model" },
  { agentKind: "demo-agent-b", label: "Agent B", model: "demo-model" },
  { agentKind: "demo-agent-c", label: "Agent C", model: "demo-model" },
  { agentKind: "demo-agent-d", label: "Agent D", model: "demo-model" },
];

const TASK = "Add input validation to the signup form and cover it with tests.";

function seat(
  seats: readonly DemoSeat[],
  index: number,
  role: ParticipantProfile["role"],
): ParticipantProfile {
  const source = seats[index] ?? FALLBACK_SEATS[index % FALLBACK_SEATS.length]!;
  return {
    id: `demo-p${index + 1}`,
    label: source.label,
    role,
    brain: {
      kind: "agent",
      agentKind: source.agentKind,
      model: source.model,
      presentationMode: "gui",
    },
  };
}

type DemoTurn = [participant: number, round: number, phase: RoundtableTurnPhase, text: string];

const SCRIPTS: Record<
  RoundtablePattern,
  { roles: ParticipantProfile["role"][]; turns: DemoTurn[]; winner?: number }
> = {
  "build-review": {
    roles: ["builder", "reviewer"],
    winner: 0,
    turns: [
      [
        0,
        0,
        "build",
        "Added `validateSignup()` with email and password rules, wired it into the form, and showed inline errors.",
      ],
      [
        1,
        0,
        "review",
        "The email rule rejects plus-addresses, and there are no tests yet.\n- Accept `name+tag@example.com`.\n- Add unit tests for every rule.\nVERDICT: REVISE",
      ],
      [0, 1, "build", "Fixed the email pattern and added 9 unit tests (all passing)."],
      [
        1,
        1,
        "review",
        "Checked the diff and ran the tests: the rules are correct and covered.\nVERDICT: APPROVE",
      ],
    ],
  },
  debate: {
    roles: ["member", "member", "member"],
    winner: 1,
    turns: [
      [0, 0, "propose", "Validate on submit with a schema library; show all errors at once."],
      [
        1,
        0,
        "propose",
        "Validate each field on blur with small pure functions; no new dependency.",
      ],
      [
        2,
        0,
        "propose",
        "Server-side validation only, mirrored in the UI from the API's error codes.",
      ],
      [
        0,
        1,
        "critique",
        "Blur validation reads better for users; I now suggest a schema plus blur triggers.",
      ],
      [
        1,
        1,
        "critique",
        "Server errors still need mapping; I keep pure functions and add API error mapping.",
      ],
      [
        2,
        1,
        "critique",
        "Agreed the UI needs instant feedback; I join the pure-function approach.",
      ],
      [0, 2, "decide", "Smallest change that covers both sides.\nPICK: 2"],
      [2, 2, "decide", "No new dependency and testable.\nPICK: 2"],
      [1, 2, "decide", "The schema option is also solid.\nPICK: 1"],
    ],
  },
  relay: {
    roles: ["planner", "builder", "tester", "reviewer"],
    turns: [
      [
        0,
        0,
        "plan",
        "1. Add pure validators. 2. Wire them on blur and submit. 3. Map API errors. 4. Tests.",
      ],
      [1, 0, "build", "Implemented the plan in `signup/validation.ts` and the form component."],
      [2, 0, "test", "Ran the suite: 42 passed. Added 6 tests for the new validators."],
      [3, 0, "review", "Diff is focused and the tests cover the rules.\nVERDICT: APPROVE"],
    ],
  },
  race: {
    roles: ["builder", "builder", "builder"],
    winner: 0,
    turns: [
      [0, 0, "race", "Pure validators plus a `useFieldErrors` hook; 8 tests."],
      [1, 0, "race", "Schema-based validation with a resolver; 5 tests."],
      [2, 0, "race", "Validation inside the submit handler; 2 tests."],
      [
        0,
        1,
        "cross-review",
        "The second entry adds a dependency for little gain; the third lacks tests.\nPICK: 2",
      ],
      [1, 1, "cross-review", "The first entry is the cleanest and best tested.\nPICK: 1"],
      [2, 1, "cross-review", "The first entry covers more edge cases.\nPICK: 1"],
    ],
  },
  open: {
    roles: ["member", "member", "member"],
    turns: [
      [
        0,
        0,
        "reply",
        "I'd validate on blur and again on submit. @Agent B, do you see an accessibility issue with inline errors?",
      ],
      [
        1,
        0,
        "reply",
        "Inline errors are fine if they use `aria-describedby` and a polite live region.",
      ],
      [
        2,
        0,
        "reply",
        "Agreed; also keep the submit button enabled so screen readers hear the errors.",
      ],
      [1, 1, "reply", "To answer the question directly: yes, link each error to its field."],
    ],
  },
};

/** A finished demo session (fake turns; no threads, nothing runs). */
export function buildDemoSession(input: {
  id: string;
  pattern: RoundtablePattern;
  projectId: string;
  now: number;
  seats?: readonly DemoSeat[];
}): RoundtableSession {
  const script = SCRIPTS[input.pattern];
  const seats = input.seats?.length ? input.seats : FALLBACK_SEATS;
  const participants = script.roles.map((role, index) => seat(seats, index, role));
  const noteId = "demo-note-1";
  const start = input.now - script.turns.length * 60_000;
  const turns: RoundtableTurn[] = script.turns.map(([participant, round, phase, text], index) => {
    const startedAt = start + index * 60_000;
    const turn: RoundtableTurn = {
      id: `demo-turn-${index + 1}`,
      participantId: participants[participant]!.id,
      round,
      phase,
      prompt: TASK,
      status: "done",
      responseText: text,
      startedAt,
      endedAt: startedAt + 45_000,
      ...(input.pattern === "open" ? { noteId } : {}),
    };
    if (/^VERDICT: APPROVE$/m.test(text)) turn.verdict = "approve";
    else if (/^VERDICT: REVISE$/m.test(text)) turn.verdict = "revise";
    const pick = text.match(/^PICK: (\d+)$/m);
    if (pick) {
      turn.verdict = "pick";
      turn.pickedParticipantId = participants[Number(pick[1]) - 1]?.id ?? participants[0]!.id;
    }
    return turn;
  });
  const open = input.pattern === "open";
  return {
    id: input.id,
    version: 1,
    title: open ? "Signup form ideas" : "Signup validation",
    task: TASK,
    pattern: input.pattern,
    projectId: input.projectId,
    participants,
    threadIds: {},
    maxRounds: open ? 0 : 4,
    status: open ? "running" : "done",
    turns,
    ...(open
      ? {
          notes: [
            {
              id: noteId,
              text: "How should the signup form show validation errors?",
              createdAt: start - 30_000,
            },
          ],
        }
      : {}),
    ...(script.winner !== undefined
      ? { winnerParticipantId: participants[script.winner]!.id }
      : {}),
    ...(open
      ? {}
      : {
          outcome:
            input.pattern === "race"
              ? { reason: "crown" as const, rationale: "Best tested and no new dependency." }
              : input.pattern === "debate"
                ? { reason: "vote" as const }
                : { reason: "approved" as const },
        }),
    createdAt: start - 60_000,
    updatedAt: input.now,
  };
}
