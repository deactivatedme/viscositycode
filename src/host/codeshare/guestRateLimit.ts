import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { CODE_SHARE_APP_PATH, ShareError } from "@/shared/codeShare";

const MINUTE_MS = 60_000;
export const INVITE_REQUESTS_PER_SOURCE = 12;

class MinuteLimit {
  private startedAt = -MINUTE_MS;
  private total = 0;
  private readonly sources = new Map<string, number>();

  constructor(
    private readonly perSource: number,
    private readonly global: number,
  ) {}

  consume(source: string, now: number): number {
    if (now >= this.startedAt + MINUTE_MS) {
      this.startedAt = now;
      this.total = 0;
      this.sources.clear();
    }
    const count = this.sources.get(source) ?? 0;
    if (count >= this.perSource || this.total >= this.global)
      return Math.max(1, Math.ceil((this.startedAt + MINUTE_MS - now) / 1000));

    // Only admitted requests allocate entries, bounding the map by the total limit.
    this.total++;
    this.sources.set(source, count + 1);
    return 0;
  }
}

export class GuestRateLimitError extends ShareError {
  constructor(readonly retryAfter: number) {
    super(
      429,
      "guest_rate_limited",
      "Too many CodeShare invite requests. Wait a minute and try again.",
    );
  }
}

function forwardedIp(req: IncomingMessage, trustedTunnel: boolean): string | undefined {
  // This listener binds IPv4 loopback. Trust Cloudflare's header only when
  // that exact ingress was explicitly configured and is the loopback peer.
  if (!trustedTunnel || req.socket.remoteAddress !== "127.0.0.1") return;
  const input = req.headers["cf-connecting-ip"];
  if (typeof input !== "string") return;
  const address = input.trim();
  const family = isIP(address);
  if (family === 4) return address;
  if (family === 6 && !address.includes("%")) return new URL(`http://[${address}]/`).hostname;
  return undefined;
}

export function createGuestRateLimiter(
  trustCloudflare: boolean | (() => boolean),
  now = () => performance.now(),
) {
  const redeem = new MinuteLimit(INVITE_REQUESTS_PER_SOURCE, 240);
  const admission = new MinuteLimit(120, 2400);
  return (req: IncomingMessage, path: string): void => {
    let bucket: MinuteLimit | undefined;
    if (
      req.method === "POST" &&
      (path === "/api/v1/redeem" || path === CODE_SHARE_APP_PATH + "/redeem")
    )
      bucket = redeem;
    else if (
      (req.method === "GET" && path === "/") ||
      (req.method === "POST" && path === CODE_SHARE_APP_PATH + "/claim")
    )
      bucket = admission;
    if (!bucket) return;
    const retryAfter = bucket.consume(
      forwardedIp(
        req,
        typeof trustCloudflare === "function" ? trustCloudflare() : trustCloudflare,
      ) ??
        req.socket.remoteAddress ??
        "unknown",
      now(),
    );
    if (retryAfter) throw new GuestRateLimitError(retryAfter);
  };
}
