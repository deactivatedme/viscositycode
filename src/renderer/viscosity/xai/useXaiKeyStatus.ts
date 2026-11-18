/**
 * ViscosityCode: xAI API key status for Settings and brain pickers.
 *
 * One small store shared by every reader, so saving a key in Settings updates
 * the Bots / Roundtable pickers too. Only the status (source + last-4 hint)
 * ever reaches the renderer; the key itself stays in the main process.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { XaiKeyStatus } from "@/shared/viscosity/xaiContract";
import { getXaiBridge, toXaiBridgeError } from "./xaiBridge";

interface XaiKeyState {
  available: boolean;
  status: XaiKeyStatus | undefined;
  loading: boolean;
  /** Localized message of the last failure, if any. */
  error: string | undefined;
}

export const useXaiKeyStore = create<XaiKeyState>()(() => ({
  available: getXaiBridge().available,
  status: undefined,
  loading: false,
  error: undefined,
}));

let inflight: Promise<void> | undefined;

export function refreshXaiKeyStatus(): Promise<void> {
  if (inflight) return inflight;
  const bridge = getXaiBridge();
  if (!bridge.available) {
    useXaiKeyStore.setState({ available: false, loading: false });
    return Promise.resolve();
  }
  useXaiKeyStore.setState({ available: true, loading: true });
  inflight = bridge
    .keyStatus()
    .then(
      (status) => useXaiKeyStore.setState({ status, loading: false, error: undefined }),
      (error: unknown) => {
        const failure = toXaiBridgeError(error);
        useXaiKeyStore.setState({
          loading: false,
          error: failure.message,
          ...(failure.code === "unavailable" ? { available: false } : {}),
        });
      },
    )
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

async function updateKey(run: () => Promise<XaiKeyStatus>): Promise<XaiKeyStatus> {
  useXaiKeyStore.setState({ loading: true, error: undefined });
  try {
    const status = await run();
    useXaiKeyStore.setState({ status, loading: false });
    return status;
  } catch (error) {
    const failure = toXaiBridgeError(error);
    useXaiKeyStore.setState({ loading: false, error: failure.message });
    throw failure;
  }
}

/** Store a pasted key (OS-encrypted in main). Rejects with a localized `XaiBridgeError`. */
export function saveXaiKey(key: string): Promise<XaiKeyStatus> {
  return updateKey(() => getXaiBridge().setKey(key));
}

/** Delete the stored key. `XAI_API_KEY` from the environment, if set, still applies. */
export function removeXaiKey(): Promise<XaiKeyStatus> {
  return updateKey(() => getXaiBridge().clearKey());
}

export interface XaiKeyStatusView {
  /** False outside the desktop app (web, PWA, extension). */
  available: boolean;
  status: XaiKeyStatus | undefined;
  loading: boolean;
  error: string | undefined;
}

/** Reads the shared status and loads it on first use. */
export function useXaiKeyStatus(): XaiKeyStatusView {
  const available = useXaiKeyStore((state) => state.available);
  const status = useXaiKeyStore((state) => state.status);
  const loading = useXaiKeyStore((state) => state.loading);
  const error = useXaiKeyStore((state) => state.error);
  const needsLoad = available && status === undefined && error === undefined;
  useEffect(() => {
    if (needsLoad) void refreshXaiKeyStatus();
  }, [needsLoad]);
  return { available, status, loading, error };
}
