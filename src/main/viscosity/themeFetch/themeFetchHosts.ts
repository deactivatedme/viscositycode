/**
 * ViscosityCode: hosts a theme link may not point at (fork of Poracode).
 *
 * "Import theme from URL…" downloads from the public web only. A link (or a
 * redirect hop) whose host is `localhost` or a literal loopback, private,
 * link-local or unspecified IP address is refused before any request, so the
 * feature cannot be used to probe the user's own machine or network. A name
 * is also resolved before each hop and refused when any of its addresses is
 * (`resolvesToPublicThemeHost`, run by the session's hop guard).
 *
 * Takes `URL.hostname` as WHATWG URL parsing produces it, which already turns
 * the odd IPv4 spellings (`2130706433`, `0x7f.1`, `127.1`) into dotted
 * decimal and writes IPv6 in brackets, lower case.
 */
import { isIP, isIPv6 } from "node:net";

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !(octet >= 0 && octet <= 255))) return null;
  return octets as [number, number, number, number];
}

function isRefusedIpv4([a, b]: readonly [number, number, number, number]): boolean {
  return (
    a === 0 || // "this network", 0.0.0.0 reaches the local machine
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // shared address space (carrier-grade NAT)
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved and broadcast
  );
}

/** Eight 16-bit groups of a canonical (WHATWG-serialized) IPv6 address, or `null`. */
function parseIpv6(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const groups = part.split(":").map((group) => Number.parseInt(group, 16));
    return groups.every((group) => group >= 0 && group <= 0xffff) ? groups : null;
  };
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...head, ...Array<number>(Math.max(0, missing)).fill(0), ...tail];
}

function isRefusedIpv6(groups: readonly number[]): boolean {
  const [first = 0] = groups;
  const leadingZeros = groups.findIndex((group) => group !== 0);
  if (leadingZeros === -1) return true; // ::, unspecified
  if (leadingZeros === 7 && groups[7] === 1) return true; // ::1, loopback
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7, unique local (private)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10, link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10, old site-local
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d).
  const nat64 = first === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
  const embedsIpv4 = nat64 || leadingZeros >= 6 || (leadingZeros === 5 && groups[5] === 0xffff);
  if (!embedsIpv4) return false;
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return isRefusedIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

/** Whether a theme download must not contact this host. */
export function isRefusedThemeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = parseIpv6(host.slice(1, -1));
    // An address URL parsing accepted but this parser cannot read: refuse it.
    return groups === null || isRefusedIpv6(groups);
  }
  const ipv4 = parseIpv4(host);
  return ipv4 !== null && isRefusedIpv4(ipv4);
}

/** Whether a resolved address (as `dns.lookup` returns it) is one a theme download must not reach. */
export function isRefusedThemeAddress(address: string): boolean {
  if (!isIP(address)) return true;
  try {
    // URL parsing canonicalizes IPv6 (mixed `::ffff:1.2.3.4` notation included).
    return isRefusedThemeHost(
      new URL(`https://${isIPv6(address) ? `[${address}]` : address}/`).hostname,
    );
  } catch {
    return true; // e.g. a zoned `fe80::1%en0`
  }
}

/** Every address a host name resolves to; `dns.promises.lookup(name, { all: true })` in the app. */
export type ThemeHostLookup = (hostname: string) => Promise<readonly string[]>;

/**
 * Whether a host that passed `isRefusedThemeHost` also resolves only to public
 * addresses. A lookup failure or empty answer refuses.
 *
 * shortcut: Chromium resolves the name again for the connection, so a DNS
 * rebind between the two lookups is not caught; pinning needs a Node client
 * with a validating `lookup`, which would lose the system proxy.
 */
export async function resolvesToPublicThemeHost(
  hostname: string,
  lookup: ThemeHostLookup,
): Promise<boolean> {
  const host = hostname.replace(/\.$/, "");
  if (host.startsWith("[") || isIP(host)) return true; // a literal, already checked
  try {
    const addresses = await lookup(host);
    return addresses.length > 0 && !addresses.some(isRefusedThemeAddress);
  } catch {
    return false;
  }
}
