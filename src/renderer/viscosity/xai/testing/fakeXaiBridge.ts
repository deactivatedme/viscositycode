/**
 * ViscosityCode test helper: an in-memory `ViscosityXaiBridge` that records
 * requests and lets a test push stream events.
 */
import { vi } from "vitest";
import type {
  ViscosityXaiBridge,
  XaiKeyStatus,
  XaiResponseRequest,
  XaiStreamEvent,
} from "@/shared/viscosity/xaiContract";

export interface FakeXaiBridge extends ViscosityXaiBridge {
  requests: XaiResponseRequest[];
  cancelled: string[];
  listenerCount(): number;
  emit(event: XaiStreamEvent): void;
  keyStatusValue: XaiKeyStatus;
}

export function createFakeXaiBridge(): FakeXaiBridge {
  const listeners = new Set<(event: XaiStreamEvent) => void>();
  const bridge: FakeXaiBridge = {
    available: true,
    requests: [],
    cancelled: [],
    keyStatusValue: { configured: true, source: "stored", hint: "WXYZ" },
    listenerCount: () => listeners.size,
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    keyStatus: vi.fn<ViscosityXaiBridge["keyStatus"]>(() => Promise.resolve(bridge.keyStatusValue)),
    setKey: vi.fn<ViscosityXaiBridge["setKey"]>(() => Promise.resolve(bridge.keyStatusValue)),
    clearKey: vi.fn<ViscosityXaiBridge["clearKey"]>(() =>
      Promise.resolve({ configured: false, source: "none" }),
    ),
    respond: vi.fn<ViscosityXaiBridge["respond"]>((request) => {
      bridge.requests.push(request);
      return Promise.resolve();
    }),
    cancel: vi.fn<ViscosityXaiBridge["cancel"]>((requestId) => {
      bridge.cancelled.push(requestId);
      return Promise.resolve();
    }),
    generateImage: vi.fn<ViscosityXaiBridge["generateImage"]>(() =>
      Promise.resolve({ images: [] }),
    ),
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return bridge;
}
