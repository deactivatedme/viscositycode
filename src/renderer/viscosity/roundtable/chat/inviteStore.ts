/**
 * ViscosityCode: the open "seat a Roundtable" dialog request.
 *
 * `/roundtable` in a chat and the two palette commands only describe what to
 * start; the chat host (always mounted in the desktop shell) renders the
 * dialog for the current request. Opening it never switches the view, the
 * focused pane or a tab: the user stays where they typed.
 */
import { create } from "zustand";
import type { MessageItemPayload } from "@/shared/contracts";
import { getRuntimeItemPayload } from "@/shared/runtimeItemVisibility";
import { useAppStore } from "@/renderer/state/appStore";

export type RoundtableInviteRequest =
  | {
      /** Invite more participants into an existing chat (it keeps seat 0). */
      kind: "invite";
      projectId: string;
      originThreadId: string;
      task: string;
      /** Runs once the Roundtable has started (e.g. clear the composer that asked). */
      onStarted?: () => void;
    }
  | {
      /** Seat a new Roundtable in a project. */
      kind: "new";
      projectId: string;
      task: string;
      onStarted?: () => void;
    };

interface RoundtableInviteState {
  request: RoundtableInviteRequest | null;
  /** Bumps on every open so the dialog starts from the new request's values. */
  nonce: number;
}

export const useRoundtableInviteStore = create<RoundtableInviteState>()(() => ({
  request: null,
  nonce: 0,
}));

export function openRoundtableInvite(request: RoundtableInviteRequest): void {
  useRoundtableInviteStore.setState((state) => ({ request, nonce: state.nonce + 1 }));
}

export function closeRoundtableInvite(): void {
  if (useRoundtableInviteStore.getState().request === null) return;
  useRoundtableInviteStore.setState({ request: null });
}

/**
 * Text of the chat's latest top-level user message (text blocks only), or ""
 * when the window holds none — the default task for "invite into this chat".
 */
export function lastUserMessageText(threadId: string): string {
  const state = useAppStore.getState();
  const ids = state.runtimeItemIdsByThread[threadId] ?? [];
  const items = state.runtimeItemsByIdByThread[threadId];
  if (!items) return "";
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const item = items[ids[index]!];
    if (!item || item.type !== "user_message" || item.parentItemId) continue;
    const payload = getRuntimeItemPayload<MessageItemPayload>(item, "user_message");
    const text = (payload?.content ?? [])
      .flatMap((block) => (block.kind === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}
