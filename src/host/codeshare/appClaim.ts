import { createHmac, timingSafeEqual } from "node:crypto";
import { ShareError } from "@/shared/codeShare";
import { shareSecret } from "./store";

/**
 * The claim encodes a host-generated random session secret and a signature.
 * Retrying redemption with the same claim is idempotent. Existing redeemed
 * sessions still work after restart, when outstanding claim signatures reset.
 */
export function createAppClaims() {
  const key = shareSecret();
  const sign = (secret: string) => createHmac("sha256", key).update(secret).digest("base64url");
  return {
    issue() {
      const secret = shareSecret();
      return `${secret}.${sign(secret)}`;
    },
    verify(claim: string): string {
      const [secret, signature] = claim.split(".");
      if (
        !secret ||
        !signature ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(secret)))
      )
        throw new ShareError(409, "claim_expired", "This connection attempt expired. Try again.");
      return secret;
    },
  };
}
