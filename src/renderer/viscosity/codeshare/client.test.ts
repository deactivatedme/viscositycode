import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeShareConnection, parseShareInvite } from "./client";

const code = "A".repeat(22);
const secret = "B".repeat(43);
const signature = "C".repeat(43);
const origin = "https://share.example.test";
const invite = { code, origin };
const state = {
  serverNow: 1,
  expiresAt: 60_001,
  status: "active",
  turnsRemaining: 3,
  models: [],
  turns: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("CodeShare app transport", () => {
  it("extracts a host and code from the share URL without routing the fragment", () => {
    expect(parseShareInvite(origin + "/#invite=" + code)).toEqual(invite);
    for (const value of [
      "http://share.example.test/#invite=" + code,
      "https://user@share.example.test/#invite=" + code,
      origin + "/api/#invite=" + code,
      origin + "?invite=" + code,
    ])
      expect(() => parseShareInvite(value)).toThrow("invalid_link");
  });

  it("negotiates desktop sessions without changing the v1 redemption body", async () => {
    const claim = secret + "." + signature;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ claim }))
      .mockResolvedValueOnce(Response.json({ token: secret, state }));
    vi.stubGlobal("fetch", fetcher);
    await CodeShareConnection.join(invite, {}, true);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      origin + "/api/v1/app/redeem?desktop=1&room=2",
      expect.objectContaining({ body: JSON.stringify({ code, claim }) }),
    );
  });

  it("recovers a lost redemption response with the original signed claim", async () => {
    const claim = secret + "." + signature;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ claim }))
      .mockRejectedValueOnce(new TypeError("interrupted connection"))
      .mockResolvedValueOnce(Response.json({ token: secret, state }))
      .mockResolvedValueOnce(Response.json(state));
    vi.stubGlobal("fetch", fetcher);
    const attempt = {};
    await expect(CodeShareConnection.join(invite, attempt)).rejects.toMatchObject({
      code: "offline",
    });
    const joined = await CodeShareConnection.join(invite, attempt);
    expect(joined.state).toEqual(state);
    await joined.client.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      origin + "/api/v1/app/redeem",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        body: JSON.stringify({ code, claim }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      origin + "/api/v1/app/session",
      expect.objectContaining({
        headers: { Authorization: "Bearer " + secret },
        credentials: "omit",
      }),
    );
  });

  it("uses the redeemed bearer to recover when the host restarted before sending a receipt", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "claim_expired" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(state));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      CodeShareConnection.join(invite, { claim: secret + "." + signature }),
    ).resolves.toMatchObject({ state });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(origin + "/api/v1/app/session");
  });
});
