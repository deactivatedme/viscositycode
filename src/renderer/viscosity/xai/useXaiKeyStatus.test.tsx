import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { XAI_BRIDGE_ERROR_PREFIX } from "@/shared/viscosity/xaiContract";
import { createFakeXaiBridge } from "./testing/fakeXaiBridge";
import { removeXaiKey, saveXaiKey, useXaiKeyStatus, useXaiKeyStore } from "./useXaiKeyStatus";

function resetStore(available: boolean): void {
  useXaiKeyStore.setState({ available, status: undefined, loading: false, error: undefined });
}

describe("useXaiKeyStatus", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "viscosityHost");
    resetStore(false);
  });

  it("reports unavailable outside the desktop app without calling anything", () => {
    resetStore(false);
    const { result } = renderHook(() => useXaiKeyStatus());
    expect(result.current).toEqual({
      available: false,
      status: undefined,
      loading: false,
      error: undefined,
    });
  });

  it("loads the status once and shares updates after saving or removing a key", async () => {
    const bridge = createFakeXaiBridge();
    window.viscosityHost = { xai: bridge };
    resetStore(true);
    const first = renderHook(() => useXaiKeyStatus());
    const second = renderHook(() => useXaiKeyStatus());
    await waitFor(() => expect(first.result.current.status?.source).toBe("stored"));
    expect(second.result.current.status?.hint).toBe("WXYZ");
    expect(bridge.keyStatus).toHaveBeenCalledTimes(1);

    bridge.keyStatusValue = { configured: true, source: "stored", hint: "NEW1" };
    await act(async () => {
      await saveXaiKey("xai-pasted-key-0123456789NEW1");
    });
    expect(second.result.current.status?.hint).toBe("NEW1");

    await act(async () => {
      await removeXaiKey();
    });
    expect(first.result.current.status).toEqual({ configured: false, source: "none" });
  });

  it("surfaces a localized error when saving fails", async () => {
    const bridge = createFakeXaiBridge();
    bridge.setKey = () =>
      Promise.reject(
        new Error(`${XAI_BRIDGE_ERROR_PREFIX}{"code":"invalid-key-format","message":"x"}`),
      );
    window.viscosityHost = { xai: bridge };
    resetStore(true);
    const { result } = renderHook(() => useXaiKeyStatus());
    await waitFor(() => expect(result.current.status).toBeDefined());
    await act(async () => {
      await expect(saveXaiKey("nope")).rejects.toMatchObject({ code: "invalid-key-format" });
    });
    expect(result.current.error).toContain("console.x.ai");
    expect(result.current.loading).toBe(false);
  });
});
