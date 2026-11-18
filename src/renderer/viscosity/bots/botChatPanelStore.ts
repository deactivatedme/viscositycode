/**
 * ViscosityCode: which API bot's chat the center panel shows (fork of
 * Poracode). A view state of this window only, never persisted; agent bots
 * open as ordinary threads in panes instead.
 *
 * Like the Roundtable panel, it opens only on an explicit user action and
 * steps aside as soon as the user navigates to a thread, another center view,
 * the inline editor, or a Roundtable.
 */
import { create } from "zustand";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useRoundtableViewStore } from "@/renderer/viscosity/roundtable";

interface BotChatPanelState {
  openBotId: string | null;
  open: (botId: string) => void;
  close: () => void;
}

export const useBotChatPanelStore = create<BotChatPanelState>()((set) => ({
  openBotId: null,
  open: (botId) => {
    const editor = useFileEditorStore.getState();
    if (editor.overlayMode === "modal") editor.setOverlayMode(null);
    set({ openBotId: botId });
  },
  close: () => set({ openBotId: null }),
}));

export function closeBotChatPanel(): void {
  if (useBotChatPanelStore.getState().openBotId !== null) useBotChatPanelStore.getState().close();
}

/**
 * Close the panel when the user goes elsewhere. Installed outside React by the
 * panel host; returns the unsubscribe.
 */
export function startBotChatPanelSync(): () => void {
  const unsubscribeEditor = useFileEditorStore.subscribe((state, previous) => {
    if (state.overlayMode === "modal" && previous.overlayMode !== "modal") closeBotChatPanel();
  });
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    const openedThread =
      state.pendingActiveThreadId !== null &&
      state.pendingActiveThreadId !== previous.pendingActiveThreadId;
    if (openedThread || state.view.kind !== previous.view.kind) closeBotChatPanel();
  });
  const unsubscribeRoundtable = useRoundtableViewStore.subscribe((state, previous) => {
    if (state.shown && !previous.shown) closeBotChatPanel();
  });
  return () => {
    unsubscribeEditor();
    unsubscribeApp();
    unsubscribeRoundtable();
  };
}
