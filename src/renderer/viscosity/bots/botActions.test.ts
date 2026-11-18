import type { PersistStorage } from "zustand/middleware";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartRoundtableInput } from "../roundtable/api";
import type { BotProfile } from "./api";

type ToastFn = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => ({
  shellActive: true,
  activateThreadTab: vi.fn<(threadId: string) => void>(),
  hideRoundtablePanel: vi.fn<() => void>(),
  openRoundtableView: vi.fn<(sessionId: string) => void>(),
  openRoundtableTab: vi.fn<(sessionId: string) => void>(),
  startRoundtable: vi.fn<(input: StartRoundtableInput) => Promise<string>>(),
  ensureAgentBotThread:
    vi.fn<(bot: BotProfile, onCreated?: (threadId: string) => void) => Promise<string>>(),
  liveBotThreadId: vi.fn<(bot: BotProfile) => string | undefined>(),
  toastInfo: vi.fn<ToastFn>(),
}));

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: (): PersistStorage<unknown> => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => ({
  activateThreadTab: mocks.activateThreadTab,
}));
vi.mock("@/renderer/viscosity/roundtable", async () => {
  const { create } = await import("zustand");
  return {
    hideRoundtablePanel: mocks.hideRoundtablePanel,
    openRoundtableView: mocks.openRoundtableView,
    openRoundtableTab: mocks.openRoundtableTab,
    useRoundtableViewStore: create(() => ({ openSessionId: null, shown: false, setup: null })),
  };
});
vi.mock("../roundtable/api", () => ({ startRoundtable: mocks.startRoundtable }));
vi.mock("./botAgentThread", () => ({
  ensureAgentBotThread: mocks.ensureAgentBotThread,
  liveBotThreadId: mocks.liveBotThreadId,
}));
vi.mock("@/renderer/viscosity/shellFlag", () => ({
  isViscosityShellActive: () => mocks.shellActive,
}));
vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast: {
    info: mocks.toastInfo,
    danger: vi.fn<ToastFn>(),
    success: vi.fn<ToastFn>(),
    warning: vi.fn<ToastFn>(),
  },
}));

import type { ParticipantBrain } from "../roundtable/types";
import { openBot, startBotGroupChat } from "./api";
import { saveBotEdits, startNewBotSession } from "./botActions";
import { useBotChatsStore } from "./botApiChat";
import { useBotChatPanelStore } from "./botChatPanelStore";
import { DEFAULT_BOT_XAI_DEFAULTS, type NewBotInput, useBotsStore } from "./botStore";

const AGENT: ParticipantBrain = {
  kind: "agent",
  agentKind: "provider-a",
  model: "model-1",
  presentationMode: "gui",
};
const GROK: ParticipantBrain = {
  kind: "xai",
  model: "grok-4.7",
  region: "global",
  tools: { webSearch: true, xSearch: false },
};

function addBot(overrides: Partial<NewBotInput> = {}) {
  return useBotsStore.getState().createBot({
    label: "Reviewer",
    brain: AGENT,
    projectId: "project-1",
    avatar: { glyph: "", color: "accent" },
    ...overrides,
  });
}

describe("openBot routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shellActive = true;
    mocks.liveBotThreadId.mockReturnValue(undefined);
    useBotsStore.setState({
      bots: {},
      order: [],
      xaiDefaults: DEFAULT_BOT_XAI_DEFAULTS,
      hydrated: true,
    });
    useBotChatsStore.setState({ chats: {}, running: {} });
    useBotChatPanelStore.setState({ openBotId: null });
  });

  it("shows an agent bot's existing thread in the focused pane without launching", async () => {
    const bot = addBot();
    mocks.liveBotThreadId.mockReturnValue("thread-7");
    useBotChatPanelStore.setState({ openBotId: "other-bot" });

    await openBot(bot.id);

    expect(mocks.activateThreadTab).toHaveBeenCalledWith("thread-7");
    expect(mocks.ensureAgentBotThread).not.toHaveBeenCalled();
    expect(useBotChatPanelStore.getState().openBotId).toBeNull();
  });

  it("creates an agent bot's thread once and shows it as soon as it exists", async () => {
    const bot = addBot();
    mocks.ensureAgentBotThread.mockImplementation(async (_bot, onCreated) => {
      onCreated?.("thread-new");
      return "thread-new";
    });

    await openBot(bot.id);

    expect(mocks.ensureAgentBotThread).toHaveBeenCalledTimes(1);
    expect(mocks.ensureAgentBotThread.mock.calls[0]?.[0]).toMatchObject({ id: bot.id });
    expect(mocks.activateThreadTab).toHaveBeenCalledWith("thread-new");
  });

  it("opens an API bot in the center chat panel with its own chat, never a thread", async () => {
    const bot = addBot({ label: "Grok helper", brain: GROK });

    await openBot(bot.id);

    const chatId = useBotsStore.getState().bots[bot.id]?.chatId;
    expect(chatId).toBeTruthy();
    expect(useBotChatsStore.getState().chats[chatId!]?.botId).toBe(bot.id);
    expect(useBotChatPanelStore.getState().openBotId).toBe(bot.id);
    expect(mocks.hideRoundtablePanel).toHaveBeenCalled();
    expect(mocks.ensureAgentBotThread).not.toHaveBeenCalled();
    expect(mocks.activateThreadTab).not.toHaveBeenCalled();

    // Opening again reuses the same chat.
    await openBot(bot.id);
    expect(useBotsStore.getState().bots[bot.id]?.chatId).toBe(chatId);
  });

  it("explains instead of opening an API bot chat outside the desktop layout", async () => {
    mocks.shellActive = false;
    const bot = addBot({ label: "Grok helper", brain: GROK });

    await openBot(bot.id);

    expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    expect(useBotChatPanelStore.getState().openBotId).toBeNull();
  });

  it("rejects an unknown bot", async () => {
    await expect(openBot("missing")).rejects.toThrow("This bot no longer exists.");
  });

  it("starts a fresh session but keeps the profile", async () => {
    const agentBot = addBot();
    useBotsStore.getState().setBotChatId(agentBot.id, "thread-old");
    mocks.ensureAgentBotThread.mockResolvedValue("thread-fresh");
    await startNewBotSession(agentBot.id);
    expect(mocks.ensureAgentBotThread.mock.calls[0]?.[0]).not.toHaveProperty("chatId");

    const grokBot = addBot({ label: "Grok helper", brain: GROK });
    await openBot(grokBot.id);
    const firstChat = useBotsStore.getState().bots[grokBot.id]?.chatId;
    await startNewBotSession(grokBot.id);
    const secondChat = useBotsStore.getState().bots[grokBot.id]?.chatId;
    expect(secondChat).toBeTruthy();
    expect(secondChat).not.toBe(firstChat);
    expect(useBotChatsStore.getState().chats[firstChat!]).toBeUndefined();
    expect(useBotsStore.getState().bots[grokBot.id]?.label).toBe("Grok helper");
  });
});

describe("saveBotEdits", () => {
  beforeEach(() => {
    useBotsStore.setState({ bots: {}, order: [], hydrated: true });
    useBotChatsStore.setState({ chats: {}, running: {} });
  });

  it("starts a new agent thread next time when the agent or model changes", async () => {
    const bot = addBot();
    useBotsStore.getState().setBotChatId(bot.id, "thread-1");
    await saveBotEdits(bot.id, {
      label: "Reviewer",
      brain: { ...AGENT, model: "model-2" },
      projectId: "project-1",
      avatar: { glyph: "", color: "accent" },
    });
    expect(useBotsStore.getState().bots[bot.id]).not.toHaveProperty("chatId");
    expect(useBotsStore.getState().bots[bot.id]?.brain).toMatchObject({ model: "model-2" });
  });

  it("keeps an agent thread for profile-only edits and a Grok chat across region changes", async () => {
    const agentBot = addBot();
    useBotsStore.getState().setBotChatId(agentBot.id, "thread-1");
    await saveBotEdits(agentBot.id, {
      label: "Reviewer Prime",
      brain: AGENT,
      projectId: "project-1",
      avatar: { glyph: "🦉", color: "project-icon-blue" },
      memory: "Likes tests.",
    });
    expect(useBotsStore.getState().bots[agentBot.id]).toMatchObject({
      chatId: "thread-1",
      label: "Reviewer Prime",
      memory: "Likes tests.",
    });

    const grokBot = addBot({ label: "Grok helper", brain: GROK });
    await openBot(grokBot.id);
    const chatId = useBotsStore.getState().bots[grokBot.id]?.chatId;
    await saveBotEdits(grokBot.id, {
      label: "Grok helper",
      brain: { ...GROK, region: "us" },
      projectId: "project-1",
      avatar: { glyph: "", color: "accent" },
    });
    expect(useBotsStore.getState().bots[grokBot.id]?.chatId).toBe(chatId);
  });
});

describe("startBotGroupChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBotsStore.setState({ bots: {}, order: [], hydrated: true });
    mocks.startRoundtable.mockResolvedValue("rt-1");
  });

  it("starts an open-pattern Roundtable seating the bots without switching to it", async () => {
    const reviewer = addBot({ instructions: "Review diffs.", memory: "Uses Vitest." });
    const grok = addBot({
      label: "Grok helper",
      brain: GROK,
      avatar: { glyph: "🛰️", color: "project-icon-teal" },
    });

    await expect(startBotGroupChat([reviewer.id, grok.id], "project-1")).resolves.toBe("rt-1");

    const input = mocks.startRoundtable.mock.calls[0]![0];
    expect(input).toMatchObject({ pattern: "open", projectId: "project-1" });
    expect(input.title).toContain("Reviewer");
    expect(input.participants).toEqual([
      {
        id: reviewer.id,
        label: "Reviewer",
        role: "member",
        brain: AGENT,
        instructions: "Review diffs.\n\nMemory notes:\nUses Vitest.",
        avatar: { glyph: "R", color: "accent" },
      },
      {
        id: grok.id,
        label: "Grok helper",
        role: "member",
        brain: GROK,
        avatar: { glyph: "🛰️", color: "project-icon-teal" },
      },
    ]);
    // Its tab is added in the background; the view never switches by itself.
    expect(mocks.openRoundtableTab).toHaveBeenCalledWith("rt-1");
    expect(mocks.openRoundtableView).not.toHaveBeenCalled();
  });

  it("needs two to five known bots", async () => {
    const only = addBot();
    await expect(startBotGroupChat([only.id], "project-1")).rejects.toThrow(
      "A group chat needs 2 to 5 bots.",
    );
    await expect(startBotGroupChat([only.id, "missing"], "project-1")).rejects.toThrow(
      "This bot no longer exists.",
    );
    expect(mocks.startRoundtable).not.toHaveBeenCalled();
  });
});
