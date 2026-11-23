import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  createGuestRateLimiter,
  GuestRateLimitError,
  INVITE_REQUESTS_PER_SOURCE,
} from "./guestRateLimit";

function request(forwarded?: string, method = "POST", peer = "127.0.0.1"): IncomingMessage {
  return {
    method,
    headers: { ...(forwarded ? { "cf-connecting-ip": forwarded } : {}) },
    socket: { remoteAddress: peer },
  } as IncomingMessage;
}

describe("guest CodeShare rate limiting", () => {
  const web = "/api/v1/redeem";
  const app = "/api/v1/app/redeem";

  it("shares the browser and desktop bucket and ignores untrusted forwarded addresses", () => {
    let clock = 0;
    const consume = createGuestRateLimiter(false, () => clock);
    for (let i = 0; i < INVITE_REQUESTS_PER_SOURCE; i++)
      consume(request("192.0.2." + (i + 1)), i % 2 === 0 ? web : app);
    expect(() => consume(request("198.51.100.2"), app)).toThrow(GuestRateLimitError);
    clock = 58_501;
    expect(() => consume(request(), app)).toThrow(expect.objectContaining({ retryAfter: 2 }));
    clock = 60_000;
    expect(() => consume(request(), app)).not.toThrow();
  });

  it("uses separate Cloudflare visitors while enforcing the total budget", () => {
    const consume = createGuestRateLimiter(true, () => 0);
    for (let i = 0; i < 240; i++) consume(request("192.0.2." + (i + 1)), app);
    expect(() => consume(request("198.51.100.20"), web)).toThrow(GuestRateLimitError);
    expect(() => consume(request("198.51.100.20"), "/api/v1/app/session")).not.toThrow();
  });

  it("normalizes equivalent IPv6 spellings and bounds claim issuance separately", () => {
    const consume = createGuestRateLimiter(true, () => 0);
    for (let i = 0; i < INVITE_REQUESTS_PER_SOURCE; i++)
      consume(request(i % 2 === 0 ? "2001:db8::1" : "2001:0db8:0:0:0:0:0:1"), app);
    expect(() => consume(request("2001:db8::1"), web)).toThrow(GuestRateLimitError);
    for (let i = 0; i < 120; i++) consume(request("2001:db8::1"), "/api/v1/app/claim");
    expect(() => consume(request("2001:db8::1", "GET"), "/")).toThrow(GuestRateLimitError);
    expect(() => consume(request("2001:db8::2"), web)).not.toThrow();
    expect(() => consume(request("fe80::1%lo0"), web)).not.toThrow();
  });
});
