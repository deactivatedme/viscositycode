import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPushGateway,
  createWebPushPublicKeyResolver,
  resolvePushGatewayUrl,
  type CreatePushGatewayOptions,
} from "./pushGateway";

type GatewayFetch = NonNullable<CreatePushGatewayOptions["fetchImpl"]>;

describe("push gateway default (ViscosityCode)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has no default gateway; only PORACODE_PUSH_GATEWAY_URL enables one", () => {
    vi.stubEnv("PORACODE_PUSH_GATEWAY_URL", "");
    expect(resolvePushGatewayUrl()).toBeNull();
    vi.stubEnv("PORACODE_PUSH_GATEWAY_URL", "  https://push.example.test  ");
    expect(resolvePushGatewayUrl()).toBe("https://push.example.test");
  });

  it("sends nothing and reports nothing when no gateway is configured", async () => {
    vi.stubEnv("PORACODE_PUSH_GATEWAY_URL", "");
    const fetchImpl = vi.fn<GatewayFetch>();
    const onError = vi.fn<(error: unknown) => void>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const send = createPushGateway({ fetchImpl, onError });
      await expect(
        send({ platform: "android", token: "t", pushType: "alert", payload: {} }),
      ).resolves.toEqual({
        ok: false,
        status: 0,
        unregistered: false,
        reason: "No push gateway is configured.",
      });
      await expect(
        send({
          platform: "web",
          subscription: { endpoint: "https://push.example/sub", keys: { p256dh: "p", auth: "a" } },
          pushType: "alert",
          payload: {},
        } as never),
      ).resolves.toMatchObject({ ok: false, unregistered: false });

      const resolveKey = createWebPushPublicKeyResolver({ fetchImpl, onError });
      await expect(resolveKey()).rejects.toThrow("No push gateway is configured.");

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      send.dispose?.();
      resolveKey.dispose?.();
    } finally {
      warn.mockRestore();
    }
  });

  it("still uses a configured gateway", async () => {
    vi.stubEnv("PORACODE_PUSH_GATEWAY_URL", "https://push.example.test");
    const fetchImpl = vi.fn<GatewayFetch>(async () => Response.json({ publicKey: "BKey" }));
    const resolveKey = createWebPushPublicKeyResolver({ fetchImpl });
    await expect(resolveKey()).resolves.toBe("BKey");
    expect(fetchImpl).toHaveBeenCalledWith("https://push.example.test/api/push", expect.anything());
    resolveKey.dispose?.();
  });
});
