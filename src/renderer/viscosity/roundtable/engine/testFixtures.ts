/**
 * Test-only helpers for the Roundtable engine: an in-memory session repo, a
 * scripted fake participant driver and session builders. Never imported by
 * production code.
 */
import type {
  ParticipantDriver,
  ParticipantProfile,
  ParticipantRole,
  RoundtablePattern,
  RoundtableSession,
  SendTurnOptions,
  TurnProgressListener,
  TurnResult,
} from "../types";
import { RoundtableRunner, type RaceAdapter, type RoundtableRepo, type RunnerDeps } from "./runner";

export function agentSeat(
  id: string,
  label: string,
  role: ParticipantRole = "member",
): ParticipantProfile {
  return {
    id,
    label,
    role,
    brain: { kind: "agent", agentKind: `kind-${id}`, model: "model-1", presentationMode: "gui" },
  };
}

export function makeSession(
  pattern: RoundtablePattern,
  participants: ParticipantProfile[],
  overrides: Partial<RoundtableSession> = {},
): RoundtableSession {
  return {
    id: "session-1",
    version: 1,
    title: "Test",
    task: "Build the thing.",
    pattern,
    projectId: "project-1",
    participants,
    threadIds: {},
    maxRounds: pattern === "debate" ? 1 : pattern === "open" ? 0 : 3,
    status: "running",
    turns: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export interface MemoryRepo extends RoundtableRepo {
  put(session: RoundtableSession): void;
}

export function memoryRepo(): MemoryRepo {
  const sessions = new Map<string, RoundtableSession>();
  return {
    get: (id) => sessions.get(id),
    put: (session) => sessions.set(session.id, session),
    update: (id, update) => {
      const current = sessions.get(id);
      if (!current) return;
      const next = update(current);
      if (next !== current) sessions.set(id, next);
    },
  };
}

export interface FakeCall {
  participantId: string;
  prompt: string;
  options: SendTurnOptions | undefined;
}

export type FakeScript = (call: FakeCall, index: number) => TurnResult | Promise<TurnResult>;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function said(text: string): TurnResult {
  return { status: "done", text };
}

export class FakeDriver implements ParticipantDriver {
  readonly calls: FakeCall[] = [];
  stopCalls = 0;
  disposed = false;
  private pendingStop: ((result: TurnResult) => void) | undefined;

  constructor(
    readonly participantId: string,
    private readonly script: FakeScript,
    private readonly boundThreadId?: () => string | undefined,
    readonly awaitResult?: () => TurnResult | Promise<TurnResult>,
  ) {
    if (awaitResult) {
      this.awaitCurrentTurn = async (
        _onProgress?: TurnProgressListener,
        _options?: SendTurnOptions,
      ) => awaitResult();
    }
  }

  awaitCurrentTurn?: NonNullable<ParticipantDriver["awaitCurrentTurn"]>;

  async ensureStarted(): Promise<void> {}

  sendTurn(
    prompt: string,
    _onProgress?: TurnProgressListener,
    options?: SendTurnOptions,
  ): Promise<TurnResult> {
    const call = { participantId: this.participantId, prompt, options };
    this.calls.push(call);
    const stopped = new Promise<TurnResult>((resolve) => {
      this.pendingStop = resolve;
    });
    return Promise.race([Promise.resolve(this.script(call, this.calls.length - 1)), stopped]);
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.pendingStop?.({ status: "stopped", text: "" });
  }

  threadId(): string | undefined {
    return this.boundThreadId?.();
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface Harness {
  repo: MemoryRepo;
  runner: RoundtableRunner;
  drivers: Map<string, FakeDriver>;
  /** Every prompt, in send order, with its participant. */
  log: FakeCall[];
  session(): RoundtableSession;
}

export function harness(
  session: RoundtableSession,
  scripts: Record<string, FakeScript>,
  overrides: Partial<RunnerDeps> & {
    awaitResults?: Record<string, () => TurnResult | Promise<TurnResult>>;
  } = {},
): Harness {
  const repo = memoryRepo();
  repo.put(session);
  const drivers = new Map<string, FakeDriver>();
  const log: FakeCall[] = [];
  let id = 0;
  let clock = 1_000;
  const race: RaceAdapter = overrides.race ?? {
    launch: () => Promise.reject(new Error("no race")),
    crown: async () => undefined,
  };
  const runner = new RoundtableRunner({
    repo,
    createDriver: (profile) => {
      const script = scripts[profile.id] ?? (() => said(""));
      const driver = new FakeDriver(
        profile.id,
        (call, index) => {
          log.push(call);
          return script(call, index);
        },
        () => repo.get(session.id)?.threadIds[profile.id],
        overrides.awaitResults?.[profile.id],
      );
      drivers.set(profile.id, driver);
      return driver;
    },
    race,
    readOriginContext: overrides.readOriginContext ?? (async () => undefined),
    describeError: (error) => (error instanceof Error ? error.message : String(error)),
    newId: () => `id-${++id}`,
    now: () => (clock += 10),
  });
  return { repo, runner, drivers, log, session: () => repo.get(session.id)! };
}
