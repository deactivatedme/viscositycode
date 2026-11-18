import { afterEach, describe, expect, it } from "vitest";
import { XAI_BRIDGE_ERROR_PREFIX, type XaiStreamEvent } from "@/shared/viscosity/xaiContract";
import { createFakeXaiBridge } from "./testing/fakeXaiBridge";
import {
  XaiBridgeError,
  getXaiBridge,
  isXaiBridgeAvailable,
  localizeXaiStreamEvent,
  toXaiBridgeError,
} from "./xaiBridge";

function encoded(payload: Record<string, unknown>): Error {
  return new Error(`${XAI_BRIDGE_ERROR_PREFIX}${JSON.stringify(payload)}`);
}

describe("getXaiBridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "viscosityHost");
  });

  it("reports unavailable outside the desktop app", async () => {
    const bridge = getXaiBridge();
    expect(bridge.available).toBe(false);
    expect(isXaiBridgeAvailable()).toBe(false);
    await expect(bridge.keyStatus()).resolves.toEqual({ configured: false, source: "none" });
    await expect(bridge.setKey("x")).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      bridge.respond({
        requestId: "r",
        model: "grok-4.7",
        region: "global",
        input: [],
        tools: { webSearch: false, xSearch: false },
      }),
    ).rejects.toBeInstanceOf(XaiBridgeError);
    await expect(bridge.cancel("r")).resolves.toBeUndefined();
    expect(typeof bridge.onEvent(() => undefined)).toBe("function");
  });

  it("wraps the preload bridge, decoding errors and localizing stream errors", async () => {
    const raw = createFakeXaiBridge();
    raw.setKey = () =>
      Promise.reject(encoded({ code: "storage-unavailable", message: "English text" }));
    window.viscosityHost = { xai: raw };
    const bridge = getXaiBridge();
    expect(bridge.available).toBe(true);
    expect(getXaiBridge()).toBe(bridge);
    await expect(bridge.keyStatus()).resolves.toEqual(raw.keyStatusValue);
    const error = await bridge.setKey("xai-key").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(XaiBridgeError);
    expect((error as XaiBridgeError).code).toBe("storage-unavailable");
    expect((error as XaiBridgeError).message).toContain("XAI_API_KEY");

    const events: XaiStreamEvent[] = [];
    const unsubscribe = bridge.onEvent((event) => events.push(event));
    raw.emit({ requestId: "r", type: "delta", text: "a" });
    raw.emit({ requestId: "r", type: "error", message: "English", code: "auth", status: 401 });
    unsubscribe();
    raw.emit({ requestId: "r", type: "delta", text: "late" });
    expect(events).toEqual([
      { requestId: "r", type: "delta", text: "a" },
      {
        requestId: "r",
        type: "error",
        code: "auth",
        status: 401,
        message: "xAI didn't accept the API key. Check the key in Settings or XAI_API_KEY.",
      },
    ]);
  });

  it("ignores a bridge that is not marked available", () => {
    window.viscosityHost = { xai: { ...createFakeXaiBridge(), available: false } };
    expect(getXaiBridge().available).toBe(false);
  });
});

describe("toXaiBridgeError", () => {
  it("decodes the code and keeps the API detail for codes where it helps", () => {
    const error = toXaiBridgeError(
      encoded({
        code: "bad-request",
        message: "x",
        detail: "Field 'input' is invalid",
        status: 400,
      }),
    );
    expect(error.code).toBe("bad-request");
    expect(error.status).toBe(400);
    expect(error.message).toBe("xAI rejected the request. (Field 'input' is invalid)");
  });

  it("maps a missing main handler to unavailable and anything else to unknown", () => {
    expect(
      toXaiBridgeError(
        new Error(
          "Error invoking remote method 'viscosity:xai:key-status': Error: No handler registered for 'viscosity:xai:key-status'",
        ),
      ).code,
    ).toBe("unavailable");
    expect(toXaiBridgeError(new Error("boom")).code).toBe("unknown");
    expect(toXaiBridgeError(encoded({ code: "not-a-code" })).code).toBe("unknown");
    expect(toXaiBridgeError(new Error(`${XAI_BRIDGE_ERROR_PREFIX}{broken`)).code).toBe("unknown");
  });

  it("leaves non-error events untouched", () => {
    const event: XaiStreamEvent = { requestId: "r", type: "done", text: "t" };
    expect(localizeXaiStreamEvent(event)).toBe(event);
  });
});
