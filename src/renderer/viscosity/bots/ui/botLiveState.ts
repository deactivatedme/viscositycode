/**
 * ViscosityCode Bots UI: a bot's live state for its sidebar dot and the
 * activity bar badge (fork of Poracode). Agent bots read their thread's status
 * (host-derived, like every thread row); API bots read whether a reply is
 * streaming. Selectors return primitives, so streaming deltas never re-render
 * a row.
 */
import type { ThreadStatus } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { getThreadMap } from "@/renderer/state/useThread";
import type { BotProfile } from "../api";
import { useBotChatsStore } from "../botApiChat";
import { useBotsStore } from "../botStore";

export type BotLiveState = "idle" | "working" | "attention" | "error";

export function botStateFromThreadStatus(status: ThreadStatus | undefined): BotLiveState {
  switch (status) {
    case "launching":
    case "working":
      return "working";
    case "needs_approval":
    case "needs_reply":
      return "attention";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function useBotLiveState(bot: Pick<BotProfile, "brain" | "chatId">): BotLiveState {
  const apiBrain = bot.brain.kind === "xai";
  const chatId = bot.chatId;
  const threadStatus = useAppStore((state) =>
    !apiBrain && chatId ? getThreadMap(state.threads).get(chatId)?.status : undefined,
  );
  const apiState = useBotChatsStore((state): BotLiveState => {
    if (!apiBrain || !chatId) return "idle";
    if (state.running[chatId]) return "working";
    return state.chats[chatId]?.messages.at(-1)?.status === "failed" ? "error" : "idle";
  });
  return apiBrain ? apiState : botStateFromThreadStatus(threadStatus);
}

/** Agent bot thread ids, newline-joined: a primitive selector result. */
function selectAgentChatKey(state: ReturnType<typeof useBotsStore.getState>): string {
  return state.order
    .flatMap((id) => {
      const bot = state.bots[id];
      return bot?.brain.kind === "agent" && bot.chatId ? [bot.chatId] : [];
    })
    .join("\n");
}

/** Bots waiting for the user (an approval or a question), for the activity bar badge. */
export function useBotsAttentionCount(): number | null {
  const chatKey = useBotsStore(selectAgentChatKey);
  const count = useAppStore((state) => {
    if (!chatKey) return 0;
    const threads = getThreadMap(state.threads);
    let waiting = 0;
    for (const threadId of chatKey.split("\n")) {
      if (botStateFromThreadStatus(threads.get(threadId)?.status) === "attention") waiting += 1;
    }
    return waiting;
  });
  return count > 0 ? count : null;
}
