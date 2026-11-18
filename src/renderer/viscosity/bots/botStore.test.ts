import type { PersistStorage, StorageValue } from "zustand/middleware";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  writes: [] as Array<{ name: string; value: unknown }>,
}));

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: (): PersistStorage<unknown> => ({
    getItem: (name) => (memory.values.get(name) as StorageValue<unknown> | undefined) ?? null,
    setItem: (name, value) => {
      memory.values.set(name, value);
      memory.writes.push({ name, value });
    },
    removeItem: (name) => {
      memory.values.delete(name);
    },
  }),
}));

import {
  BOTS_STORE_NAME,
  BOTS_STORE_VERSION,
  DEFAULT_BOT_XAI_DEFAULTS,
  sanitizeBotsState,
  selectBotList,
  useBotsStore,
} from "./botStore";

const agentBrain = {
  kind: "agent",
  agentKind: "provider-a",
  model: "model-1",
  presentationMode: "gui",
} as const;

function storedBot(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot-1",
    label: "Review Buddy",
    role: "member",
    brain: agentBrain,
    projectId: "project-1",
    avatar: { glyph: "🤖", color: "project-icon-blue" },
    instructions: "Review diffs.",
    memory: "Uses Vitest.",
    chatId: "thread-1",
    createdAt: 10,
    ...overrides,
  };
}

describe("bots store persistence", () => {
  beforeEach(() => {
    memory.values.clear();
    memory.writes.length = 0;
    useBotsStore.setState({
      bots: {},
      order: [],
      xaiDefaults: DEFAULT_BOT_XAI_DEFAULTS,
      hydrated: true,
    });
  });

  it("persists only the data under the fork's versioned dbStorage name", () => {
    const options = useBotsStore.persist.getOptions();
    expect(options.name).toBe(BOTS_STORE_NAME);
    expect(BOTS_STORE_NAME).toBe("poracode-viscosity-bots");
    expect(options.version).toBe(BOTS_STORE_VERSION);
    expect(BOTS_STORE_VERSION).toBe(1);
    const persisted = options.partialize!(useBotsStore.getState());
    expect(Object.keys(persisted).toSorted()).toEqual(["bots", "order", "xaiDefaults"]);
  });

  it("migrates an older or unknown blob by keeping only trustworthy bots", async () => {
    const migrate = useBotsStore.persist.getOptions().migrate!;
    const migrated = await migrate(
      {
        bots: {
          "bot-1": storedBot(),
          // Missing brain model: dropped.
          "bot-2": storedBot({ id: "bot-2", brain: { kind: "agent", agentKind: "x" } }),
          // Key and id disagree: dropped.
          "bot-3": storedBot({ id: "other" }),
          // Unknown brain kind: dropped.
          "bot-4": storedBot({ id: "bot-4", brain: { kind: "mystery" } }),
        },
        order: ["missing", "bot-1", "bot-1", 7],
        xaiDefaults: { region: "eu", tools: { webSearch: "yes", xSearch: true } },
        legacyField: true,
      },
      0,
    );
    expect(migrated).toEqual({
      bots: { "bot-1": storedBot() },
      order: ["bot-1"],
      xaiDefaults: { region: "global", tools: { webSearch: true, xSearch: true } },
    });
  });

  it("repairs avatars, models and lengths it can still use", () => {
    const state = sanitizeBotsState({
      bots: {
        a: storedBot({ id: "a", avatar: { glyph: "  ", color: "not-a-token" } }),
        b: storedBot({
          id: "b",
          label: "Grok helper",
          brain: { kind: "xai", model: "grok-unknown", region: "us", tools: { webSearch: true } },
          avatar: { glyph: "TOOLONG", color: "#12abef" },
        }),
      },
      order: ["b"],
    });
    expect(state.order).toEqual(["b", "a"]);
    expect(state.bots.a?.avatar).toEqual({ glyph: "RB", color: "accent" });
    expect(state.bots.b?.avatar).toEqual({ glyph: "GH", color: "#12abef" });
    expect(state.bots.b?.brain).toEqual({
      kind: "xai",
      model: "grok-4.7",
      region: "us",
      tools: { webSearch: true, xSearch: false },
    });
  });

  it("rehydrates a same-version blob through the sanitizer", async () => {
    // Every state change writes the blob, so reset first and plant the blob last.
    useBotsStore.setState({ hydrated: false });
    memory.values.set(BOTS_STORE_NAME, {
      state: {
        bots: { "bot-1": storedBot(), broken: { id: "broken" } },
        order: ["broken", "bot-1"],
        xaiDefaults: { region: "us", tools: { webSearch: false, xSearch: true } },
      },
      version: BOTS_STORE_VERSION,
    });
    await useBotsStore.persist.rehydrate();
    const state = useBotsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(Object.keys(state.bots)).toEqual(["bot-1"]);
    expect(state.order).toEqual(["bot-1"]);
    expect(state.xaiDefaults).toEqual({ region: "us", tools: { webSearch: false, xSearch: true } });
  });

  it("writes new bots without runtime fields", () => {
    const bot = useBotsStore.getState().createBot({
      label: "  Planner  ",
      brain: agentBrain,
      projectId: "project-1",
      avatar: { glyph: " ", color: "accent" },
      instructions: "   ",
      memory: " Keep it short. ",
    });
    expect(bot).toMatchObject({
      label: "Planner",
      role: "member",
      avatar: { glyph: "P", color: "accent" },
      memory: "Keep it short.",
    });
    expect(bot).not.toHaveProperty("instructions");
    const last = memory.writes.at(-1);
    expect(last?.name).toBe(BOTS_STORE_NAME);
    const written = last?.value as { state: Record<string, unknown>; version: number };
    expect(written.version).toBe(BOTS_STORE_VERSION);
    expect(written.state).not.toHaveProperty("hydrated");
    expect(written.state.order).toEqual([bot.id]);
  });
});

describe("bots store actions", () => {
  beforeEach(() => {
    useBotsStore.setState({ bots: {}, order: [], xaiDefaults: DEFAULT_BOT_XAI_DEFAULTS });
  });

  it("updates, re-chats and deletes a bot", () => {
    const store = useBotsStore.getState();
    const bot = store.createBot({
      label: "Tester",
      brain: agentBrain,
      projectId: "project-1",
      avatar: { glyph: "🧪", color: "project-icon-green" },
      instructions: "Write tests.",
    });
    store.updateBot(bot.id, { instructions: "", memory: "Prefers Vitest." });
    expect(useBotsStore.getState().bots[bot.id]).not.toHaveProperty("instructions");
    expect(useBotsStore.getState().bots[bot.id]?.memory).toBe("Prefers Vitest.");

    store.setBotChatId(bot.id, "thread-9");
    expect(useBotsStore.getState().bots[bot.id]?.chatId).toBe("thread-9");
    store.setBotChatId(bot.id, undefined);
    expect(useBotsStore.getState().bots[bot.id]).not.toHaveProperty("chatId");

    store.deleteBot(bot.id);
    expect(useBotsStore.getState().bots).toEqual({});
    expect(useBotsStore.getState().order).toEqual([]);
  });

  it("returns the same ordered list until a bot changes", () => {
    const store = useBotsStore.getState();
    const first = store.createBot({
      label: "One",
      brain: agentBrain,
      projectId: "p",
      avatar: { glyph: "", color: "accent" },
    });
    const second = store.createBot({
      label: "Two",
      brain: agentBrain,
      projectId: "p",
      avatar: { glyph: "", color: "accent" },
    });
    const list = selectBotList(useBotsStore.getState());
    expect(list.map((bot) => bot.id)).toEqual([first.id, second.id]);
    expect(selectBotList(useBotsStore.getState())).toBe(list);
    store.setXaiDefaults({ region: "us" });
    expect(selectBotList(useBotsStore.getState())).toBe(list);
    store.updateBot(first.id, { label: "Uno" });
    expect(selectBotList(useBotsStore.getState())).not.toBe(list);
  });
});
