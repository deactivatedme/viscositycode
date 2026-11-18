/**
 * ViscosityCode Bots UI: which bot dialog is open (fork of Poracode). A view
 * state of this window only; `nonce` remounts a dialog so each opening starts
 * from fresh form state.
 *
 * Dialogs open from the sidebar view and from the center chat panel, so both
 * mount a dialog host; the first mounted host renders them (a lease), so a
 * dialog never shows twice and survives either surface unmounting.
 */
import { useEffect, useId } from "react";
import { create } from "zustand";

export type BotsDialog =
  | { kind: "editor"; nonce: number; botId?: string }
  | { kind: "group-chat"; nonce: number; botIds?: string[] }
  | { kind: "delete"; nonce: number; botId: string };

interface BotsDialogState {
  dialog: BotsDialog | null;
  /** Mounted dialog hosts, oldest first; the first one renders the dialogs. */
  hosts: string[];
}

export const useBotsDialogStore = create<BotsDialogState>()(() => ({ dialog: null, hosts: [] }));

/** True for the one mounted host that should render the dialogs. */
export function useBotsDialogHostLease(): boolean {
  const hostId = useId();
  useEffect(() => {
    useBotsDialogStore.setState((state) => ({ hosts: [...state.hosts, hostId] }));
    return () => {
      useBotsDialogStore.setState((state) => ({
        hosts: state.hosts.filter((id) => id !== hostId),
      }));
    };
  }, [hostId]);
  return useBotsDialogStore((state) => state.hosts[0] === hostId);
}

let nonce = 0;

export function openBotEditor(botId?: string): void {
  nonce += 1;
  useBotsDialogStore.setState({
    dialog: { kind: "editor", nonce, ...(botId ? { botId } : {}) },
  });
}

export function openBotGroupChatDialog(botIds?: string[]): void {
  nonce += 1;
  useBotsDialogStore.setState({
    dialog: { kind: "group-chat", nonce, ...(botIds ? { botIds } : {}) },
  });
}

export function confirmDeleteBot(botId: string): void {
  nonce += 1;
  useBotsDialogStore.setState({ dialog: { kind: "delete", nonce, botId } });
}

export function closeBotsDialog(): void {
  if (useBotsDialogStore.getState().dialog !== null) useBotsDialogStore.setState({ dialog: null });
}
