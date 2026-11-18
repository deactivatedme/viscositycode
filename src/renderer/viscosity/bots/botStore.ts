/**
 * ViscosityCode: the saved bots (fork of Poracode).
 *
 * Bot profiles are this desktop's own data, persisted through the generic
 * key/value `dbStorage` (SQLite on the desktop, IndexedDB in a browser
 * client) like other renderer stores. They are never host-authoritative and
 * never hold transcripts or keys: an agent bot's conversation is a host
 * thread (only its id is kept), and the xAI key stays in the main process.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDbStorage } from "@/renderer/state/dbStorage";
import type { XaiRegion } from "@/shared/viscosity/xaiContract";
import type { ParticipantBrain } from "../roundtable/types";
import type { BotProfile } from "./api";
import { botInitials, sanitizeBotProfile } from "./botModel";

export const BOTS_STORE_NAME = "poracode-viscosity-bots";
export const BOTS_STORE_VERSION = 1;

export interface BotXaiDefaults {
  region: XaiRegion;
  tools: { webSearch: boolean; xSearch: boolean };
}

export const DEFAULT_BOT_XAI_DEFAULTS: BotXaiDefaults = {
  region: "global",
  tools: { webSearch: true, xSearch: false },
};

export interface NewBotInput {
  label: string;
  brain: ParticipantBrain;
  projectId: string;
  avatar: { glyph: string; color: string };
  instructions?: string;
  memory?: string;
}

export type BotPatch = Partial<
  Pick<BotProfile, "label" | "brain" | "projectId" | "avatar" | "instructions" | "memory">
>;

interface BotsPersistedState {
  bots: Record<string, BotProfile>;
  order: string[];
  xaiDefaults: BotXaiDefaults;
}

export interface BotsStore extends BotsPersistedState {
  /** False until the persisted blob has been read (hydration is asynchronous). */
  hydrated: boolean;
  createBot: (input: NewBotInput) => BotProfile;
  updateBot: (botId: string, patch: BotPatch) => void;
  deleteBot: (botId: string) => void;
  /** Current chat (thread id for agent brains, conversation id for API brains). */
  setBotChatId: (botId: string, chatId: string | undefined) => void;
  setXaiDefaults: (patch: Partial<BotXaiDefaults>) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeXaiDefaults(value: unknown): BotXaiDefaults {
  if (!isRecord(value)) return DEFAULT_BOT_XAI_DEFAULTS;
  const tools = isRecord(value.tools) ? value.tools : {};
  return {
    region: value.region === "us" ? "us" : "global",
    tools: {
      webSearch:
        typeof tools.webSearch === "boolean"
          ? tools.webSearch
          : DEFAULT_BOT_XAI_DEFAULTS.tools.webSearch,
      xSearch:
        typeof tools.xSearch === "boolean" ? tools.xSearch : DEFAULT_BOT_XAI_DEFAULTS.tools.xSearch,
    },
  };
}

/**
 * Trusted state from any persisted blob: invalid bots are dropped, ids keep
 * the stored order, and bots missing from the order are appended.
 */
export function sanitizeBotsState(value: unknown): BotsPersistedState {
  const source = isRecord(value) ? value : {};
  const rawBots = isRecord(source.bots) ? source.bots : {};
  const bots: Record<string, BotProfile> = {};
  for (const [id, raw] of Object.entries(rawBots)) {
    const bot = sanitizeBotProfile(raw);
    if (bot && bot.id === id) bots[id] = bot;
  }
  const storedOrder = Array.isArray(source.order) ? source.order : [];
  const order: string[] = [];
  for (const id of storedOrder) {
    if (typeof id === "string" && bots[id] && !order.includes(id)) order.push(id);
  }
  for (const id of Object.keys(bots)) {
    if (!order.includes(id)) order.push(id);
  }
  return { bots, order, xaiDefaults: sanitizeXaiDefaults(source.xaiDefaults) };
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const useBotsStore = create<BotsStore>()(
  persist(
    (set) => ({
      bots: {},
      order: [],
      xaiDefaults: DEFAULT_BOT_XAI_DEFAULTS,
      hydrated: false,
      createBot: (input) => {
        const instructions = trimmedOrUndefined(input.instructions);
        const memory = trimmedOrUndefined(input.memory);
        const label = input.label.trim();
        const bot: BotProfile = {
          id: crypto.randomUUID(),
          label,
          role: "member",
          brain: input.brain,
          projectId: input.projectId,
          avatar: {
            glyph: input.avatar.glyph.trim() || botInitials(label),
            color: input.avatar.color,
          },
          ...(instructions ? { instructions } : {}),
          ...(memory ? { memory } : {}),
          createdAt: Date.now(),
        };
        set((state) => ({
          bots: { ...state.bots, [bot.id]: bot },
          order: [...state.order, bot.id],
        }));
        return bot;
      },
      updateBot: (botId, patch) =>
        set((state) => {
          const current = state.bots[botId];
          if (!current) return state;
          const next: BotProfile = { ...current };
          if (patch.label !== undefined) next.label = patch.label.trim() || current.label;
          if (patch.brain !== undefined) next.brain = patch.brain;
          if (patch.projectId !== undefined) next.projectId = patch.projectId;
          if (patch.avatar !== undefined) {
            next.avatar = {
              glyph: patch.avatar.glyph.trim() || botInitials(next.label),
              color: patch.avatar.color,
            };
          }
          if ("instructions" in patch) {
            const instructions = trimmedOrUndefined(patch.instructions);
            if (instructions) next.instructions = instructions;
            else delete next.instructions;
          }
          if ("memory" in patch) {
            const memory = trimmedOrUndefined(patch.memory);
            if (memory) next.memory = memory;
            else delete next.memory;
          }
          return { bots: { ...state.bots, [botId]: next } };
        }),
      deleteBot: (botId) =>
        set((state) => {
          if (!state.bots[botId]) return state;
          const { [botId]: _removed, ...bots } = state.bots;
          return { bots, order: state.order.filter((id) => id !== botId) };
        }),
      setBotChatId: (botId, chatId) =>
        set((state) => {
          const current = state.bots[botId];
          if (!current || current.chatId === chatId) return state;
          const next: BotProfile = { ...current };
          if (chatId) next.chatId = chatId;
          else delete next.chatId;
          return { bots: { ...state.bots, [botId]: next } };
        }),
      setXaiDefaults: (patch) =>
        set((state) => ({
          xaiDefaults: {
            region: patch.region ?? state.xaiDefaults.region,
            tools: { ...state.xaiDefaults.tools, ...patch.tools },
          },
        })),
    }),
    {
      name: BOTS_STORE_NAME,
      version: BOTS_STORE_VERSION,
      storage: createDbStorage<BotsPersistedState>(),
      // v1 is the first shape; anything older or unknown is sanitized, never trusted.
      migrate: (persistedState) => sanitizeBotsState(persistedState),
      // Same-version blobs are sanitized too: another build may have written them.
      merge: (persistedState, current) => ({
        ...current,
        ...sanitizeBotsState(persistedState),
      }),
      partialize: (state) => ({
        bots: state.bots,
        order: state.order,
        xaiDefaults: state.xaiDefaults,
      }),
      onRehydrateStorage: () => () => {
        useBotsStore.setState({ hydrated: true });
      },
    },
  ),
);

const EMPTY_BOTS: BotProfile[] = [];
let cachedSource: { bots: BotsStore["bots"]; order: BotsStore["order"] } | null = null;
let cachedList: BotProfile[] = EMPTY_BOTS;

/** Bots in display order; the same array (treat as read-only) until a bot or the order changes. */
export function selectBotList(state: Pick<BotsStore, "bots" | "order">): BotProfile[] {
  if (cachedSource?.bots === state.bots && cachedSource.order === state.order) return cachedList;
  cachedSource = { bots: state.bots, order: state.order };
  const list = state.order
    .map((id) => state.bots[id])
    .filter((bot): bot is BotProfile => bot !== undefined);
  cachedList = list.length === 0 ? EMPTY_BOTS : list;
  return cachedList;
}

export function getBot(botId: string | undefined): BotProfile | undefined {
  return botId ? useBotsStore.getState().bots[botId] : undefined;
}

/** Resolves once the persisted bots have been read (immediately when already hydrated). */
export function whenBotsHydrated(): Promise<void> {
  if (useBotsStore.getState().hydrated || useBotsStore.persist.hasHydrated()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsubscribe = useBotsStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}
