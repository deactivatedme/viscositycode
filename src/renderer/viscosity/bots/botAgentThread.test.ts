import type { PersistStorage } from "zustand/middleware";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: {
    projects: [] as Array<Record<string, unknown>>,
    threads: [] as Array<Record<string, unknown>>,
    createThread: vi.fn<(input: Record<string, unknown>) => Record<string, unknown>>(),
  },
  statuses: [] as Array<Record<string, unknown>>,
  disabledAgents: [] as string[],
  performInitialThreadLaunch: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
  markThreadLaunchFailed: vi.fn<(threadId: string, error: unknown) => void>(),
  uncertain: false,
}));

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: (): PersistStorage<unknown> => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));
vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: { getState: () => mocks.app },
}));
vi.mock("@/renderer/state/entityHost", () => ({ entityHost: () => undefined }));
vi.mock("@/renderer/state/remoteServersStore", () => ({
  useRemoteServersStore: { getState: () => ({ runtime: {} }) },
}));
vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: {
    getState: () => ({
      disabledAgents: mocks.disabledAgents,
      providerConfigs: {},
      providerModelPreferences: {},
    }),
  },
}));
vi.mock("@/renderer/hooks/useHostAgentStatuses", () => ({
  readHostAgentStatusPools: () => ({ windows: [], wsl: [] }),
  selectLocationAgentStatuses: () => mocks.statuses,
}));
vi.mock("@/renderer/components/thread/threadDraftViewHelpers", () => ({
  agentWithCapabilities: (agent: unknown) => agent,
  resolveSavedProviderDraftConfig: () => ({ effort: "high", mode: "autopilot" }),
  resolveProviderDraftConfig: (_agent: unknown, preferred: Record<string, unknown>) => ({
    ...preferred,
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  }),
  launchSelectionFields: (draft: { model: string; effort?: string }) => ({
    model: draft.model,
    ...(draft.effort ? { effort: draft.effort } : {}),
  }),
}));
vi.mock("@/renderer/actions/threadLaunchActions", () => ({
  performInitialThreadLaunch: mocks.performInitialThreadLaunch,
  markThreadLaunchFailed: mocks.markThreadLaunchFailed,
}));
vi.mock("@/renderer/actions/threadCommandOutcomeActions", () => ({
  isRemoteCommandOutcomeUncertainError: () => mocks.uncertain,
}));

import type { BotProfile } from "./api";
import { BotLaunchError, ensureAgentBotThread, liveBotThreadId } from "./botAgentThread";
import { useBotsStore } from "./botStore";

const PROJECT = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix", path: "/work/project" },
};

function readyStatus(overrides: Record<string, unknown> = {}) {
  return {
    kind: "provider-a",
    label: "Provider A",
    installed: true,
    authState: "authenticated",
    capabilities: {
      presentationMode: "gui",
      presentationModes: ["gui", "terminal"],
      models: [{ id: "model-1", label: "Model 1" }],
    },
    ...overrides,
  };
}

function bot(overrides: Partial<BotProfile> = {}): BotProfile {
  const created = useBotsStore.getState().createBot({
    label: "Reviewer",
    brain: { kind: "agent", agentKind: "provider-a", model: "model-1", presentationMode: "gui" },
    projectId: "project-1",
    avatar: { glyph: "", color: "accent" },
    instructions: "Review my diffs.",
    memory: "We use Vitest.",
  });
  return { ...created, ...overrides };
}

describe("ensureAgentBotThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uncertain = false;
    mocks.disabledAgents = [];
    mocks.statuses = [readyStatus()];
    mocks.app.projects = [PROJECT];
    mocks.app.threads = [];
    mocks.app.createThread.mockImplementation((input) => {
      const thread = { id: input.threadId, projectId: input.projectId, ...input };
      mocks.app.threads = [thread, ...mocks.app.threads];
      return thread;
    });
    mocks.performInitialThreadLaunch.mockResolvedValue(undefined);
    useBotsStore.setState({ bots: {}, order: [], hydrated: true });
  });

  it("creates a background GUI thread named after the bot with its preamble", async () => {
    const profile = bot();
    const shown: string[] = [];

    const threadId = await ensureAgentBotThread(profile, (id) => shown.push(id));

    const input = mocks.app.createThread.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      projectId: "project-1",
      agentKind: "provider-a",
      title: "Reviewer",
      presentationMode: "gui",
      focus: false,
    });
    // Model selection only: the provider's own mode, approval and sandbox defaults stay.
    expect(input.config).toEqual({ model: "model-1", effort: "high" });
    expect(input.prompt).toContain('You are "Reviewer"');
    expect(input.prompt).toContain("Review my diffs.");
    expect(input.prompt).toContain("We use Vitest.");
    expect(shown).toEqual([threadId]);
    expect(useBotsStore.getState().bots[profile.id]?.chatId).toBe(threadId);
    expect(mocks.performInitialThreadLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: input.prompt,
        thread: expect.objectContaining({ id: threadId }),
      }),
    );
  });

  it("reuses a live thread and shares one launch between concurrent opens", async () => {
    const profile = bot();
    const [first, second] = await Promise.all([
      ensureAgentBotThread(profile),
      ensureAgentBotThread(profile),
    ]);
    expect(first).toBe(second);
    expect(mocks.app.createThread).toHaveBeenCalledTimes(1);

    const saved = useBotsStore.getState().bots[profile.id]!;
    expect(liveBotThreadId(saved)).toBe(first);
    await expect(ensureAgentBotThread(saved)).resolves.toBe(first);
    expect(mocks.app.createThread).toHaveBeenCalledTimes(1);
  });

  it("starts over when the remembered thread was deleted or archived", async () => {
    const profile = bot({ chatId: "thread-gone" });
    expect(liveBotThreadId(profile)).toBeUndefined();
    mocks.app.threads = [{ id: "thread-archived", archived: true }];
    expect(liveBotThreadId({ ...profile, chatId: "thread-archived" })).toBeUndefined();
  });

  it("refuses a brain that is not ready, without creating a row", async () => {
    mocks.statuses = [readyStatus({ authState: "missing", presentationAuthStates: undefined })];
    await expect(ensureAgentBotThread(bot())).rejects.toMatchObject({ code: "agent-unavailable" });
    mocks.statuses = [readyStatus()];
    mocks.disabledAgents = ["provider-a"];
    await expect(ensureAgentBotThread(bot())).rejects.toBeInstanceOf(BotLaunchError);
    mocks.disabledAgents = [];
    mocks.app.projects = [];
    await expect(ensureAgentBotThread(bot())).rejects.toMatchObject({ code: "project-missing" });
    expect(mocks.app.createThread).not.toHaveBeenCalled();
  });

  it("marks a definite launch failure, but never an uncertain one", async () => {
    mocks.performInitialThreadLaunch.mockRejectedValueOnce(new Error("spawn failed"));
    await expect(ensureAgentBotThread(bot())).rejects.toMatchObject({
      code: "launch-failed",
      uncertain: false,
    });
    expect(mocks.markThreadLaunchFailed).toHaveBeenCalledTimes(1);

    mocks.uncertain = true;
    mocks.performInitialThreadLaunch.mockRejectedValueOnce(new Error("timed out"));
    await expect(ensureAgentBotThread(bot())).rejects.toMatchObject({ uncertain: true });
    expect(mocks.markThreadLaunchFailed).toHaveBeenCalledTimes(1);
  });
});
