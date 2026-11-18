import type { PersistStorage } from "zustand/middleware";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: (): PersistStorage<unknown> => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));

import {
  createFakeXaiBridge,
  type FakeXaiBridge,
} from "@/renderer/viscosity/xai/testing/fakeXaiBridge";
import {
  BOT_CHAT_MAX_MESSAGES,
  chatHistoryTurns,
  ensureBotApiChat,
  restartBotApiChat,
  sanitizeBotChatsState,
  sendBotApiMessage,
  stopBotApiReply,
  useBotChatsStore,
} from "./botApiChat";
import { useBotsStore } from "./botStore";

let bridge: FakeXaiBridge;

function grokBot() {
  return useBotsStore.getState().createBot({
    label: "Scout",
    brain: {
      kind: "xai",
      model: "grok-4.7",
      region: "us",
      tools: { webSearch: true, xSearch: true },
    },
    projectId: "project-1",
    avatar: { glyph: "", color: "accent" },
    instructions: "Find sources.",
    memory: "Prefers primary sources.",
  });
}

async function nextRequest(index: number) {
  await vi.waitFor(() => expect(bridge.requests.length).toBeGreaterThan(index));
  return bridge.requests[index]!;
}

describe("API bot chat", () => {
  beforeEach(() => {
    bridge = createFakeXaiBridge();
    window.viscosityHost = { xai: bridge };
    useBotsStore.setState({ bots: {}, order: [], hydrated: true });
    useBotChatsStore.setState({ chats: {}, running: {} });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "viscosityHost");
  });

  it("streams a reply through the xAI driver and keeps the exchange", async () => {
    const bot = grokBot();
    const sending = sendBotApiMessage(bot.id, "  Find the spec  ");
    const request = await nextRequest(0);
    const chatId = useBotsStore.getState().bots[bot.id]!.chatId!;

    expect(request).toMatchObject({
      model: "grok-4.7",
      region: "us",
      tools: { webSearch: true, xSearch: true },
      input: [{ role: "user", content: "Find the spec" }],
    });
    expect(request.instructions).toContain('You are "Scout"');
    expect(request.instructions).toContain("Find sources.");
    expect(request.instructions).toContain("Prefers primary sources.");
    expect(useBotChatsStore.getState().running[chatId]).toBe(true);

    bridge.emit({ requestId: request.requestId, type: "delta", text: "Here " });
    bridge.emit({ requestId: request.requestId, type: "done", text: "Here it is." });
    await expect(sending).resolves.toBe(true);

    const chat = useBotChatsStore.getState().chats[chatId]!;
    expect(chat.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Find the spec" },
      { role: "assistant", text: "Here it is." },
    ]);
    expect(useBotChatsStore.getState().running[chatId]).toBeUndefined();

    // The next turn carries the conversation so far.
    const followUp = sendBotApiMessage(bot.id, "And the date?");
    const second = await nextRequest(1);
    expect(second.input).toEqual([
      { role: "user", content: "Find the spec" },
      { role: "assistant", content: "Here it is." },
      { role: "user", content: "And the date?" },
    ]);
    bridge.emit({ requestId: second.requestId, type: "done", text: "2026." });
    await followUp;
  });

  it("refuses a second message while a reply is streaming", async () => {
    const bot = grokBot();
    const first = sendBotApiMessage(bot.id, "One");
    const request = await nextRequest(0);
    await expect(sendBotApiMessage(bot.id, "Two")).resolves.toBe(false);
    bridge.emit({ requestId: request.requestId, type: "done", text: "Done." });
    await first;
    expect(bridge.requests).toHaveLength(1);
  });

  it("keeps the partial text of a stopped reply and cancels the request", async () => {
    const bot = grokBot();
    const sending = sendBotApiMessage(bot.id, "Long answer please");
    const request = await nextRequest(0);
    bridge.emit({ requestId: request.requestId, type: "delta", text: "Part" });
    const chatId = useBotsStore.getState().bots[bot.id]!.chatId!;

    await stopBotApiReply(chatId);
    await sending;

    expect(bridge.cancelled).toEqual([request.requestId]);
    const last = useBotChatsStore.getState().chats[chatId]!.messages.at(-1);
    expect(last).toMatchObject({ role: "assistant", text: "Part", status: "stopped" });
  });

  it("records a failed reply with a localized reason, and does not replay it as context", async () => {
    const bot = grokBot();
    const sending = sendBotApiMessage(bot.id, "Hi");
    const request = await nextRequest(0);
    bridge.emit({ requestId: request.requestId, type: "error", message: "401", code: "auth" });
    await sending;
    const chatId = useBotsStore.getState().bots[bot.id]!.chatId!;
    const failed = useBotChatsStore.getState().chats[chatId]!.messages.at(-1);
    expect(failed).toMatchObject({ role: "assistant", status: "failed" });
    expect(failed?.error).toMatch(/key/i);

    const retry = sendBotApiMessage(bot.id, "Hi again");
    const second = await nextRequest(1);
    expect(second.input).toEqual([{ role: "user", content: "Hi again" }]);
    bridge.emit({ requestId: second.requestId, type: "done", text: "Hello." });
    await retry;
  });

  it("starts a fresh chat on New session and drops the old one", async () => {
    const bot = grokBot();
    const first = ensureBotApiChat(bot.id)!;
    useBotChatsStore.getState().appendMessage(first, { role: "user", text: "old" });
    const second = await restartBotApiChat(bot.id);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(useBotChatsStore.getState().chats[first]).toBeUndefined();
    expect(useBotChatsStore.getState().chats[second!]?.messages).toEqual([]);
  });
});

describe("API bot chat persistence helpers", () => {
  it("turns finished exchanges into driver history, skipping failed and stopped replies", () => {
    const turns = chatHistoryTurns("bot-1", [
      { id: "1", role: "user", text: "a", createdAt: 1 },
      { id: "2", role: "assistant", text: "A", createdAt: 2 },
      { id: "3", role: "user", text: "b", createdAt: 3 },
      { id: "4", role: "assistant", text: "B?", createdAt: 4, status: "failed", error: "x" },
      { id: "5", role: "user", text: "c", createdAt: 5 },
      { id: "6", role: "assistant", text: "C", createdAt: 6 },
    ]);
    expect(turns.map(({ prompt, responseText }) => [prompt, responseText])).toEqual([
      ["a", "A"],
      ["c", "C"],
    ]);
    expect(turns.every((turn) => turn.participantId === "bot-1" && turn.status === "done")).toBe(
      true,
    );
  });

  it("sanitizes a stored blob and keeps only the newest messages", () => {
    const messages = Array.from({ length: BOT_CHAT_MAX_MESSAGES + 5 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      text: `t${index}`,
      createdAt: index,
    }));
    const state = sanitizeBotChatsState({
      chats: {
        good: {
          id: "good",
          botId: "bot-1",
          messages: [...messages, { id: "bad", role: "system" }],
        },
        mismatched: { id: "other", botId: "bot-1", messages: [] },
        orphan: { id: "orphan", messages: [] },
      },
    });
    expect(Object.keys(state.chats)).toEqual(["good"]);
    expect(state.chats.good?.messages).toHaveLength(BOT_CHAT_MAX_MESSAGES);
    expect(state.chats.good?.messages.at(-1)?.id).toBe(`m${BOT_CHAT_MAX_MESSAGES + 4}`);
  });
});
