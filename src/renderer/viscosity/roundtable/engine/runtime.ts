/**
 * ViscosityCode Roundtable engine: wiring. Builds the runner with the live
 * services once, registers the built-in "agent" driver and the Grok
 * ("xai") driver, resumes sessions after a reload (main window only), and
 * installs the DEV hook.
 *
 * Orchestration runs in the main window only: secondary windows (thread and
 * side-chat windows, the quick composer) may show Roundtables but never
 * resume them, so two windows never drive the same session.
 */
import { msg } from "@lingui/core/macro";
import { isConversationWindow, isQuickComposerWindow } from "@/renderer/bridge";
import { hasAnyClientBridge } from "@/renderer/clientRuntime";
import { i18n } from "@/renderer/i18n/i18n";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { createXaiParticipantDriver } from "@/renderer/viscosity/xai/XaiParticipantDriver";
import type { StartRoundtableInput } from "../api";
import { useRoundtableStore, waitForRoundtableHydration } from "../roundtableStore";
import type { RoundtablePattern } from "../types";
import { seedWorkspace } from "./compare";
import { buildDemoSession, installRoundtableDevHook, type DemoSeat } from "./devHook";
import { createRegisteredDriver, hasDriverFactory, registerDriverFactory } from "./driverRegistry";
import { createLiveRaceAdapter, prepareWorkspace, readOriginContext } from "./liveServices";
import { threadIdsToResume, type ThreadPresenceSource, waitForThreads } from "./resumeGate";
import { RoundtableRunner, type RoundtableRepo } from "./runner";
import { createSessionRecord, validateSeed, validateStartInput } from "./session";
import { ThreadParticipantDriver } from "./threadDriver";
import type { ThreadEnginePort } from "./threadPort";
import { createLiveThreadEnginePort } from "./threadPortLive";

/** Whether the window lists a thread yet (the host catalog loads after a reload). */
const appThreadPresence: ThreadPresenceSource = {
  has: (threadId) => getThreadMap(useAppStore.getState().threads).has(threadId),
  subscribe: (listener) =>
    useAppStore.subscribe((state, previous) => {
      if (state.threads !== previous.threads) listener();
    }),
};

export const storeRepo: RoundtableRepo = {
  get: (sessionId) => useRoundtableStore.getState().sessions[sessionId],
  update: (sessionId, update) => useRoundtableStore.getState().updateSession(sessionId, update),
};

interface RoundtableRuntime {
  runner: RoundtableRunner;
  port: ThreadEnginePort;
}

let runtime: RoundtableRuntime | undefined;

function isOrchestratorWindow(): boolean {
  if (!hasAnyClientBridge()) return false;
  try {
    return !isQuickComposerWindow() && !isConversationWindow();
  } catch {
    return false;
  }
}

function demoSeats(): DemoSeat[] {
  const seats: DemoSeat[] = [];
  for (const agent of useAgentStatusesStore.getState().agentStatuses) {
    const model = agent.capabilities.models[0]?.id;
    if (!agent.installed || !model) continue;
    seats.push({ agentKind: agent.kind, label: agent.label, model });
  }
  return seats;
}

function simulate(sessionId?: string, pattern: RoundtablePattern = "build-review"): string {
  const id = sessionId ?? `demo-${crypto.randomUUID().slice(0, 8)}`;
  const projectId = useAppStore.getState().projects[0]?.id ?? "demo-project";
  useRoundtableStore
    .getState()
    .putSession(buildDemoSession({ id, pattern, projectId, now: Date.now(), seats: demoSeats() }));
  return id;
}

/** The engine singleton (created on first use). */
export function getRoundtableRuntime(): RoundtableRuntime {
  if (runtime) return runtime;
  const port = createLiveThreadEnginePort();
  if (!hasDriverFactory("agent")) {
    registerDriverFactory(
      "agent",
      (profile, session) =>
        new ThreadParticipantDriver(profile, session, port, {
          lookupThreadId: () =>
            useRoundtableStore.getState().sessions[session.id]?.threadIds[profile.id],
          recordThreadId: (threadId) =>
            storeRepo.update(session.id, (current) =>
              current.threadIds[profile.id] === threadId
                ? current
                : { ...current, threadIds: { ...current.threadIds, [profile.id]: threadId } },
            ),
        }),
    );
  }
  // Grok seats (xAI API, main process): registered with the engine itself so
  // the factory exists before any session resumes after a reload. Startup
  // order elsewhere cannot fail a Grok turn for want of a driver.
  // `registerXaiParticipantDriver()` stays a safe, idempotent alternative.
  if (!hasDriverFactory("xai")) registerDriverFactory("xai", createXaiParticipantDriver);
  const runner = new RoundtableRunner({
    repo: storeRepo,
    createDriver: createRegisteredDriver,
    race: createLiveRaceAdapter(),
    readOriginContext: (session) => readOriginContext(session, port),
    describeError: (error) => port.describeError(error),
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
  });
  runtime = { runner, port };
  installRoundtableDevHook({
    sessions: () => Object.values(useRoundtableStore.getState().sessions),
    simulate,
  });
  if (isOrchestratorWindow()) {
    void waitForRoundtableHydration()
      // The host's thread catalog usually arrives after the saved sessions:
      // resuming before it would fail every in-flight turn as "removed".
      .then(() =>
        waitForThreads(
          threadIdsToResume(Object.values(useRoundtableStore.getState().sessions)),
          appThreadPresence,
        ),
      )
      .then(() => runner.resumeAfterReload(Object.values(useRoundtableStore.getState().sessions)));
  }
  return runtime;
}

export async function startRoundtableSession(input: StartRoundtableInput): Promise<string> {
  validateStartInput(input);
  if (!isOrchestratorWindow()) {
    throw new Error(i18n._(msg`Start a Roundtable from the main window.`));
  }
  const { runner } = getRoundtableRuntime();
  await waitForRoundtableHydration();
  // A debate seeded from a comparison continues in that comparison's threads and checkout.
  const seed = input.seedFromSessionId
    ? useRoundtableStore.getState().sessions[input.seedFromSessionId]
    : undefined;
  validateSeed(input, seed);
  const id = crypto.randomUUID();
  const workspace = seed ? seedWorkspace(seed) : await prepareWorkspace(input, id);
  const session = createSessionRecord(input, {
    id,
    now: Date.now(),
    ...workspace,
    ...(seed ? { seed, newId: () => crypto.randomUUID() } : {}),
  });
  useRoundtableStore.getState().putSession(session);
  void runner.kick(id);
  return id;
}
