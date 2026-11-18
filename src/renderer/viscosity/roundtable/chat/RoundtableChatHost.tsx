/**
 * ViscosityCode: the always-mounted host for the in-chat Roundtable entry
 * points. It has no visible chrome of its own; it renders the invite dialog
 * (a portal) for the current request and mirrors the engine's session list
 * for the submit path. It rides on the status bar registry because that is
 * the fork's desktop-shell-only mount point, so the compact/PWA layout never
 * gets Roundtable chrome.
 */
import { useEffect } from "react";
import { registerStatusBarItem } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { useRoundtableList } from "../api";
import { syncKnownRoundtables } from "./chatLinksStore";
import { useRoundtableInviteStore } from "./inviteStore";
import { RoundtableInviteDialog } from "./RoundtableInviteDialog";

export const ROUNDTABLE_CHAT_HOST_ITEM_ID = "roundtable.chat-host";

export function RoundtableChatHost() {
  const sessions = useRoundtableList();
  useEffect(() => {
    syncKnownRoundtables(sessions);
  }, [sessions]);
  const request = useRoundtableInviteStore((state) => state.request);
  const nonce = useRoundtableInviteStore((state) => state.nonce);
  return request ? <RoundtableInviteDialog key={nonce} request={request} /> : null;
}

let unregister: (() => void) | null = null;

/** Idempotent: registers the host once per renderer. */
export function registerRoundtableChatHost(): void {
  if (unregister) return;
  unregister = registerStatusBarItem({
    id: ROUNDTABLE_CHAT_HOST_ITEM_ID,
    align: "right",
    // Last on the right; renders nothing inline.
    order: 10_000,
    component: RoundtableChatHost,
  });
}
