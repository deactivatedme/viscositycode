/**
 * ViscosityCode: conversations of bots whose brain is a model reached over an
 * API (Grok on the xAI API) — fork of Poracode.
 *
 * An agent bot's conversation is a host thread; an API bot has no host-side
 * conversation, so its one ongoing chat is kept here, on this desktop, through
 * `dbStorage` (bounded: the newest messages and a per-message cap). Each reply
 * streams through the xAI feature's `XaiParticipantDriver`, seeded with this
 * chat as its history; requests run in the main process, never with the key
 * in this renderer.
 *
 * Streaming never re-renders the transcript: partial text goes to a tiny
 * per-chat external store that only the live reply row subscribes to, and the
 * driver already throttles it to at most 8 updates per second.
 */
import { msg } from "@lingui/core/macro";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { i18n } from "@/renderer/i18n/i18n";
import { createDbStorage } from "@/renderer/state/dbStorage";
import { XaiParticipantDriver } from "@/renderer/viscosity/xai/XaiParticipantDriver";
import type { ParticipantProfile, RoundtableTurn, TurnResult } from "../roundtable/types";
import type { BotProfile } from "./api";
import { buildXaiBotInstructions } from "./botPrompts";
import { getBot, useBotsStore } from "./botStore";

export const BOT_CHATS_STORE_NAME = "poracode-viscosity-bot-chats";
export const BOT_CHATS_STORE_VERSION = 1;
/** Newest messages kept per chat (and sent as context). */
export const BOT_CHAT_MAX_MESSAGES = 200;
/** Characters kept per message. */
export const BOT_CHAT_MAX_MESSAGE_LENGTH = 100_000;

export interface BotChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  /** Assistant replies only: how the turn ended when it did not finish normally. */
  status?: "failed" | "stopped";
  error?: string;
}

export interface BotApiChat {
  id: string;
  botId: string;
  messages: BotChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface BotChatsPersistedState {
  chats: Record<string, BotApiChat>;
}

interface BotChatsStore extends BotChatsPersistedState {
  /** Chats with a reply streaming right now (not persisted). */
  running: Record<string, true>;
  createChat: (botId: string) => string;
  appendMessage: (chatId: string, message: Omit<BotChatMessage, "id" | "createdAt">) => void;
  deleteChat: (chatId: string) => void;
  setRunning: (chatId: string, running: boolean) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampText(text: string): string {
  return text.length > BOT_CHAT_MAX_MESSAGE_LENGTH
    ? text.slice(0, BOT_CHAT_MAX_MESSAGE_LENGTH)
    : text;
}

function sanitizeMessage(value: unknown): BotChatMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !value.id) return undefined;
  if (value.role !== "user" && value.role !== "assistant") return undefined;
  if (typeof value.text !== "string") return undefined;
  const status =
    value.role === "assistant" && (value.status === "failed" || value.status === "stopped")
      ? value.status
      : undefined;
  return {
    id: value.id,
    role: value.role,
    text: clampText(value.text),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    ...(status ? { status } : {}),
    ...(status && typeof value.error === "string" ? { error: value.error } : {}),
  };
}

export function sanitizeBotChatsState(value: unknown): BotChatsPersistedState {
  const source = isRecord(value) && isRecord(value.chats) ? value.chats : {};
  const chats: Record<string, BotApiChat> = {};
  for (const [id, raw] of Object.entries(source)) {
    if (!isRecord(raw) || raw.id !== id || typeof raw.botId !== "string" || !raw.botId) continue;
    const messages = (Array.isArray(raw.messages) ? raw.messages : [])
      .map(sanitizeMessage)
      .filter((message): message is BotChatMessage => message !== undefined)
      .slice(-BOT_CHAT_MAX_MESSAGES);
    chats[id] = {
      id,
      botId: raw.botId,
      messages,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    };
  }
  return { chats };
}

export const useBotChatsStore = create<BotChatsStore>()(
  persist(
    (set) => ({
      chats: {},
      running: {},
      createChat: (botId) => {
        const now = Date.now();
        const chat: BotApiChat = {
          id: crypto.randomUUID(),
          botId,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ chats: { ...state.chats, [chat.id]: chat } }));
        return chat.id;
      },
      appendMessage: (chatId, message) =>
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          const now = Date.now();
          const next: BotChatMessage = {
            ...message,
            id: crypto.randomUUID(),
            text: clampText(message.text),
            createdAt: now,
          };
          return {
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                messages: [...chat.messages, next].slice(-BOT_CHAT_MAX_MESSAGES),
                updatedAt: now,
              },
            },
          };
        }),
      deleteChat: (chatId) =>
        set((state) => {
          if (!state.chats[chatId]) return state;
          const { [chatId]: _removed, ...chats } = state.chats;
          const { [chatId]: _running, ...running } = state.running;
          return { chats, running };
        }),
      setRunning: (chatId, running) =>
        set((state) => {
          if (Boolean(state.running[chatId]) === running) return state;
          if (running) return { running: { ...state.running, [chatId]: true } };
          const { [chatId]: _removed, ...rest } = state.running;
          return { running: rest };
        }),
    }),
    {
      name: BOT_CHATS_STORE_NAME,
      version: BOT_CHATS_STORE_VERSION,
      storage: createDbStorage<BotChatsPersistedState>(),
      migrate: (persistedState) => sanitizeBotChatsState(persistedState),
      merge: (persistedState, current) => ({
        ...current,
        ...sanitizeBotChatsState(persistedState),
      }),
      partialize: (state) => ({ chats: state.chats }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Live reply text (the one throttled live-turn preview).

const liveText = new Map<string, string>();
const liveListeners = new Map<string, Set<() => void>>();

function setLiveText(chatId: string, text: string | undefined): void {
  if (text === undefined) liveText.delete(chatId);
  else liveText.set(chatId, text);
  for (const listener of liveListeners.get(chatId) ?? []) listener();
}

function subscribeLiveText(chatId: string, listener: () => void): () => void {
  let listeners = liveListeners.get(chatId);
  if (!listeners) {
    listeners = new Set();
    liveListeners.set(chatId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) liveListeners.delete(chatId);
  };
}

/** Partial text of the reply streaming in `chatId`, or "" when none is. */
export function useBotLiveReply(chatId: string): string {
  return useSyncExternalStore(
    (listener) => subscribeLiveText(chatId, listener),
    () => liveText.get(chatId) ?? "",
    () => "",
  );
}

// ---------------------------------------------------------------------------
// Sending.

/** The driver streaming each chat's current reply. */
const drivers = new Map<string, XaiParticipantDriver>();

/**
 * The finished exchanges of a chat as the driver's history (user prompt →
 * reply). Failed or stopped replies stay on screen but are not replayed.
 */
export function chatHistoryTurns(
  botId: string,
  messages: readonly BotChatMessage[],
): RoundtableTurn[] {
  const turns: RoundtableTurn[] = [];
  let pending: BotChatMessage | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      pending = message;
      continue;
    }
    if (pending && !message.status && message.text) {
      turns.push({
        id: message.id,
        participantId: botId,
        round: turns.length + 1,
        prompt: pending.text,
        status: "done",
        responseText: message.text,
      });
    }
    pending = undefined;
  }
  return turns;
}

/** The participant a Grok bot is to the driver: its persona travels as `instructions`. */
function xaiProfileOf(bot: BotProfile): ParticipantProfile {
  return {
    id: bot.id,
    label: bot.label,
    role: "member",
    brain: bot.brain,
    instructions: buildXaiBotInstructions(bot),
  };
}

/** The bot's current API chat, created when it has none (or its chat was removed). */
export function ensureBotApiChat(botId: string): string | undefined {
  const bot = getBot(botId);
  if (!bot || bot.brain.kind !== "xai") return undefined;
  const chats = useBotChatsStore.getState().chats;
  if (bot.chatId && chats[bot.chatId]?.botId === botId) return bot.chatId;
  const chatId = useBotChatsStore.getState().createChat(botId);
  useBotsStore.getState().setBotChatId(botId, chatId);
  return chatId;
}

function recordReply(chatId: string, result: TurnResult): void {
  const { appendMessage } = useBotChatsStore.getState();
  if (result.status === "done") {
    appendMessage(chatId, { role: "assistant", text: result.text });
    return;
  }
  appendMessage(chatId, {
    role: "assistant",
    text: result.text,
    status: result.status,
    ...(result.status === "failed"
      ? { error: result.error ?? i18n._(msg`The bot could not answer.`) }
      : {}),
  });
}

/**
 * Sends the user's message and streams the bot's reply. Resolves once the
 * reply finished, failed or was stopped (the outcome is recorded in the chat);
 * resolves false when nothing was sent (busy, empty, or not an API bot).
 */
export async function sendBotApiMessage(botId: string, text: string): Promise<boolean> {
  const prompt = text.trim();
  const bot = getBot(botId);
  if (!prompt || !bot || bot.brain.kind !== "xai") return false;
  const chatId = ensureBotApiChat(botId);
  if (!chatId || useBotChatsStore.getState().running[chatId]) return false;
  // The context is the chat before this message; the driver appends the prompt itself.
  const messages = useBotChatsStore.getState().chats[chatId]?.messages ?? [];
  const driver = new XaiParticipantDriver({
    profile: xaiProfileOf(bot),
    session: { turns: chatHistoryTurns(bot.id, messages) },
  });
  drivers.set(chatId, driver);
  const chats = useBotChatsStore.getState();
  chats.setRunning(chatId, true);
  chats.appendMessage(chatId, { role: "user", text: prompt });
  setLiveText(chatId, "");
  try {
    const result = await driver.sendTurn(prompt, (partial) => setLiveText(chatId, partial));
    recordReply(chatId, result);
    return true;
  } finally {
    if (drivers.get(chatId) === driver) drivers.delete(chatId);
    driver.dispose();
    useBotChatsStore.getState().setRunning(chatId, false);
    setLiveText(chatId, undefined);
  }
}

/** Stops the reply streaming in `chatId`; the partial text is kept, marked as stopped. */
export async function stopBotApiReply(chatId: string): Promise<void> {
  await drivers.get(chatId)?.stop();
}

/** Ends an API bot's chat (stopping any reply) and starts a fresh one; the profile stays. */
export async function restartBotApiChat(botId: string): Promise<string | undefined> {
  const bot = getBot(botId);
  if (!bot || bot.brain.kind !== "xai") return undefined;
  if (bot.chatId) {
    await stopBotApiReply(bot.chatId);
    useBotChatsStore.getState().deleteChat(bot.chatId);
  }
  useBotsStore.getState().setBotChatId(botId, undefined);
  return ensureBotApiChat(botId);
}

/** Drops a deleted bot's API chat. */
export async function forgetBotApiChat(chatId: string | undefined): Promise<void> {
  if (!chatId) return;
  await stopBotApiReply(chatId);
  useBotChatsStore.getState().deleteChat(chatId);
}
