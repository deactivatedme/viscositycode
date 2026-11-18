/**
 * ViscosityCode: account pools, settings access (fork of Poracode).
 *
 * Pools are host settings (`accountPools`, keyed by profile driver) so the
 * host failover policy, every client and background threads agree on them.
 * This module is the renderer's only door to that key: it reads through the
 * shared settings store and writes through the store's own setter, which
 * persists via the shared settings authority (never a side channel). Stored
 * values are re-read leniently (`parseStoredAccountPools`), so one malformed
 * pool never breaks the settings page.
 */
import {
  normalizePoolMembers,
  parseStoredAccountPools,
  type AccountPool,
  type AccountPools,
} from "@/shared/accountPools";
import { isRemoteSession } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { MAX_POOL_MEMBERS } from "./poolModel";

type SharedSettingsState = ReturnType<typeof useSharedSettings.getState>;

const NO_POOLS: AccountPools = {};

/**
 * True when this renderer talks to the host that owns the pools directly (the
 * managed desktop). A remote-session client (browser, PWA, or a desktop
 * attached to a standalone host) never receives `accountPools`: the key is not
 * on the remote settings wire, so its local copy is not the host's and a write
 * would reach only this device. Pools are then neither shown nor written here;
 * the host still applies its own. Fails closed while the runtime is unknown.
 */
function poolsAreHostSettings(): boolean {
  try {
    return !isRemoteSession();
  } catch {
    return false;
  }
}

/**
 * The store setter that persists pools through the shared settings authority
 * (`setAccountPools`, next to the other shared settings setters). Looked up
 * at call time so this feature refuses to write, and says so, on a store that
 * cannot persist the key instead of faking a save.
 */
type AccountPoolsSetter = (pools: AccountPools) => void;

function accountPoolsSetter(state: SharedSettingsState): AccountPoolsSetter | undefined {
  if (!poolsAreHostSettings()) return undefined;
  const setter = (state as { setAccountPools?: unknown }).setAccountPools;
  return typeof setter === "function" ? (setter as AccountPoolsSetter) : undefined;
}

/**
 * True when this build's settings store can persist pools. Pool editing UI
 * renders only then, so it never offers a change it cannot save.
 */
export function useCanWriteAccountPools(): boolean {
  return useSharedSettings((state) => accountPoolsSetter(state) !== undefined);
}

/** The stored value; reference-stable between unrelated settings changes. */
export function selectStoredAccountPools(state: SharedSettingsState): AccountPools | undefined {
  return state.accountPools;
}

/** Current pools, outside React. */
export function readAccountPools(): AccountPools {
  if (!poolsAreHostSettings()) return NO_POOLS;
  return parseStoredAccountPools(selectStoredAccountPools(useSharedSettings.getState()));
}

/** Current pools for a component; re-renders only when the stored pools change. */
export function useAccountPools(): AccountPools {
  const stored = useSharedSettings(selectStoredAccountPools);
  return poolsAreHostSettings() ? parseStoredAccountPools(stored) : NO_POOLS;
}

/**
 * Save `driver`'s pool through the shared settings store. Members are
 * normalized the way every reader normalizes them, so the stored value parses
 * back unchanged. Returns false (and writes nothing) when this build's
 * settings store cannot persist pools, so a caller never shows a change that
 * would silently be lost.
 */
export function writeAccountPool(driver: string, pool: AccountPool): boolean {
  const state = useSharedSettings.getState();
  const setAccountPools = accountPoolsSetter(state);
  if (!setAccountPools) return false;
  const members = normalizePoolMembers(driver, pool.members, state.agentInstances).slice(
    0,
    MAX_POOL_MEMBERS,
  );
  // Other drivers' pools stay exactly as stored.
  setAccountPools({ ...state.accountPools, [driver]: { ...pool, members } });
  return true;
}

/**
 * Returns a function that adds a newly created account to the end of its
 * driver's saved pool, so the host (which reads the saved members) can fail
 * over to it straight away. No-op when the driver has no saved pool, already
 * lists the account, or this store cannot persist pools: adding an account
 * never depends on the pool.
 */
export function useAccountPoolMemberAppender(): (driver: string, agentKind: string) => void {
  const stored = useSharedSettings(selectStoredAccountPools);
  const setAccountPools = useSharedSettings(accountPoolsSetter);
  return (driver, agentKind) => {
    const pool = parseStoredAccountPools(stored)[driver];
    if (!setAccountPools || !pool) return;
    if (pool.members.includes(agentKind) || pool.members.length >= MAX_POOL_MEMBERS) return;
    // The new profile is valid by construction; existing members were
    // normalized when they were written.
    setAccountPools({ ...stored, [driver]: { ...pool, members: [...pool.members, agentKind] } });
  };
}
