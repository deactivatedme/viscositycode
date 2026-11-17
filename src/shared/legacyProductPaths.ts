// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { type PoracodeChannel, productNameFor } from "./channel";

/**
 * The technical product name a pre-rebrand install used for OS-owned identity
 * (macOS Keychain and Linux secret-store entries are keyed by app name).
 *
 * ViscosityCode: the fork starts fresh and has no Lightcode or Poracode
 * installs to bridge, so its "legacy" identity is its own product name. The
 * export stays so upstream call sites compile unchanged.
 */
export function legacyProductNameFor(channel: PoracodeChannel): string {
  return productNameFor(channel);
}
