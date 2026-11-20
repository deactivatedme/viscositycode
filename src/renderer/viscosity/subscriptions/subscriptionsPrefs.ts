/**
 * ViscosityCode: Subscriptions dashboard view preferences (fork of Poracode).
 *
 * Device-local localStorage key `viscosity:subscriptions:v1`, holding the
 * owner's provider order, their pretend subscriptions and their display
 * overrides of real accounts ("Customize…"). Both are display-only: nothing
 * outside this folder reads this key or this module, so they never reach
 * Smart start, account pools, failover, usage polling,
 * Roundtable seats, notifications or the host (`subscriptionsIsolation.test.ts`).
 * Everything is sanitized on read; a foreign version reads as empty.
 */
import { create } from "zustand";
import { normalizeIdList } from "@/renderer/viscosity/smartStart/smartStartStore";

export const SUBSCRIPTIONS_PREFS_KEY = "viscosity:subscriptions:v1";
export const SUBSCRIPTIONS_PREFS_VERSION = 1;
export const MAX_ORDERED_PROVIDERS = 64;
export const MAX_PRETEND_SUBSCRIPTIONS = 20;
export const MAX_PRETEND_BARS = 8;
export const MAX_SUBSCRIPTION_OVERRIDES = 64;
export const PRETEND_LIMITS = {
  provider: 60,
  plan: 40,
  account: 80,
  barLabel: 30,
  reset: 40,
  overrideKey: 200,
} as const;

/** Order ids of pretend rows; never a real agent kind. */
export const PRETEND_PROVIDER_PREFIX = "vc-pretend:";

export interface PretendUsageBar {
  label: string;
  /** 0-100, whole numbers. */
  usedPercent: number;
  /** Shown as written, e.g. "Resets in 2h". */
  reset?: string;
}

export interface PretendSubscription {
  id: string;
  /** Provider display name, free text or a known provider's name. */
  provider: string;
  plan: string;
  account?: string;
  bars: PretendUsageBar[];
}

/**
 * What the owner typed over a real account's display values. Only the typed
 * text is kept (no snapshot, token or secret); real data keeps flowing and
 * the dashboard draws these values instead.
 */
export interface SubscriptionOverride {
  /** The real account's agent kind (the model's account identity). */
  key: string;
  /** Provider display name; the section header takes it from its first customized account. */
  provider: string;
  /** Absent: no plan chip. */
  plan?: string;
  /** Absent: the provider name stands in, as on a pretend row. */
  account?: string;
  /**
   * Typed bars that replace the real usage windows. Absent: the real windows,
   * countdowns and readiness stay live underneath the typed names.
   */
  bars?: PretendUsageBar[];
}

export interface SubscriptionsPrefs {
  /** Provider ids (and pretend order ids) in the owner's order. */
  providerOrder: string[];
  pretend: PretendSubscription[];
  overrides: SubscriptionOverride[];
}

const EMPTY_PREFS: SubscriptionsPrefs = { providerOrder: [], pretend: [], overrides: [] };
const PRETEND_ID_PATTERN = /^[a-z0-9-]{1,40}$/i;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// eslint-disable-next-line no-control-regex -- stored text is single-line display text
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;

/** Trimmed single-line text capped at `max`, or "" for anything else. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARACTERS, " ").trim().slice(0, max).trim();
}

function sanitizeBar(raw: unknown): PretendUsageBar | undefined {
  if (!isRecord(raw)) return undefined;
  const label = cleanText(raw.label, PRETEND_LIMITS.barLabel);
  const percent = raw.usedPercent;
  if (!label || typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  const reset = cleanText(raw.reset, PRETEND_LIMITS.reset);
  return {
    label,
    usedPercent: Math.round(Math.min(100, Math.max(0, percent))),
    ...(reset ? { reset } : {}),
  };
}

/** A valid pretend entry, or undefined when the provider name or plan is missing. */
export function sanitizePretendSubscription(raw: unknown): PretendSubscription | undefined {
  if (!isRecord(raw)) return undefined;
  const id = typeof raw.id === "string" && PRETEND_ID_PATTERN.test(raw.id) ? raw.id : "";
  const provider = cleanText(raw.provider, PRETEND_LIMITS.provider);
  const plan = cleanText(raw.plan, PRETEND_LIMITS.plan);
  if (!id || !provider || !plan) return undefined;
  const account = cleanText(raw.account, PRETEND_LIMITS.account);
  return { id, provider, plan, ...(account ? { account } : {}), bars: sanitizeBars(raw.bars) };
}

function sanitizeBars(value: unknown): PretendUsageBar[] {
  return (Array.isArray(value) ? value : [])
    .map(sanitizeBar)
    .filter((bar): bar is PretendUsageBar => bar !== undefined)
    .slice(0, MAX_PRETEND_BARS);
}

/** A valid override, or undefined without a usable key or provider name. */
export function sanitizeSubscriptionOverride(raw: unknown): SubscriptionOverride | undefined {
  if (!isRecord(raw)) return undefined;
  const key = cleanText(raw.key, PRETEND_LIMITS.overrideKey);
  // The key must be stored exactly as given, and never names a pretend row.
  if (!key || key !== raw.key || key.startsWith(PRETEND_PROVIDER_PREFIX)) return undefined;
  const provider = cleanText(raw.provider, PRETEND_LIMITS.provider);
  if (!provider) return undefined;
  const plan = cleanText(raw.plan, PRETEND_LIMITS.plan);
  const account = cleanText(raw.account, PRETEND_LIMITS.account);
  return {
    key,
    provider,
    ...(plan ? { plan } : {}),
    ...(account ? { account } : {}),
    ...(Array.isArray(raw.bars) ? { bars: sanitizeBars(raw.bars) } : {}),
  };
}

export function sanitizeOverrideList(value: unknown): SubscriptionOverride[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SubscriptionOverride[] = [];
  for (const raw of value) {
    const entry = sanitizeSubscriptionOverride(raw);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
    if (out.length >= MAX_SUBSCRIPTION_OVERRIDES) break;
  }
  return out;
}

export function sanitizePretendList(value: unknown): PretendSubscription[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: PretendSubscription[] = [];
  for (const raw of value) {
    const entry = sanitizePretendSubscription(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
    if (out.length >= MAX_PRETEND_SUBSCRIPTIONS) break;
  }
  return out;
}

export function readSubscriptionsPrefs(
  storage: ReadableStorage | null = defaultStorage(),
): SubscriptionsPrefs {
  if (!storage) return EMPTY_PREFS;
  try {
    const raw = storage.getItem(SUBSCRIPTIONS_PREFS_KEY);
    if (!raw) return EMPTY_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== SUBSCRIPTIONS_PREFS_VERSION) return EMPTY_PREFS;
    return {
      providerOrder: normalizeIdList(parsed.providerOrder, MAX_ORDERED_PROVIDERS),
      pretend: sanitizePretendList(parsed.pretend),
      overrides: sanitizeOverrideList(parsed.overrides),
    };
  } catch {
    return EMPTY_PREFS;
  }
}

export function writeSubscriptionsPrefs(
  prefs: SubscriptionsPrefs,
  storage: WritableStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      SUBSCRIPTIONS_PREFS_KEY,
      JSON.stringify({ version: SUBSCRIPTIONS_PREFS_VERSION, ...prefs }),
    );
  } catch {
    // Best-effort view preference (private mode, quota, blocked site data).
  }
}

/** Saved ids first in saved order; the rest after them in `fallback` rank. */
export function subscriptionRank(
  saved: readonly string[],
  fallback: (id: string) => number,
): (id: string) => number {
  return (id) => {
    const index = saved.indexOf(id);
    return index >= 0 ? index : saved.length + fallback(id);
  };
}

/**
 * The saved order after moving `movedId` to `toIndex` among the `visible`
 * ids (the dashboard's current order). Hidden ids keep their slots, so a
 * provider turned back on returns to its old place; never-saved visible ids
 * join at the end in their shown order.
 */
export function moveSubscriptionProvider(
  saved: readonly string[],
  visible: readonly string[],
  movedId: string,
  toIndex: number,
): string[] {
  const from = visible.indexOf(movedId);
  if (from < 0 || from === toIndex || toIndex < 0 || toIndex >= visible.length) return [...saved];
  const moved = visible.filter((id) => id !== movedId);
  moved.splice(toIndex, 0, movedId);
  const shown = new Set(visible);
  const combined = [...saved, ...visible.filter((id) => !saved.includes(id))];
  let next = 0;
  // shortcut: the 64-id cap drops the newest ids first; prune stale ids if owners hit it.
  return normalizeIdList(
    combined.map((id) => (shown.has(id) ? moved[next++]! : id)),
    MAX_ORDERED_PROVIDERS,
  );
}

export const useSubscriptionsPrefsStore = create<SubscriptionsPrefs>()(() =>
  readSubscriptionsPrefs(),
);

// Another tab or window on this origin saved (or cleared) the prefs: adopt
// them, so this one's next save does not write back its stale copy.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SUBSCRIPTIONS_PREFS_KEY || event.key === null) {
      useSubscriptionsPrefsStore.setState(readSubscriptionsPrefs());
    }
  });
}

function update(next: Partial<SubscriptionsPrefs>): void {
  useSubscriptionsPrefsStore.setState(next);
  writeSubscriptionsPrefs(useSubscriptionsPrefsStore.getState());
}

export function reorderSubscriptionProvider(
  visible: readonly string[],
  movedId: string,
  toIndex: number,
): void {
  const { providerOrder } = useSubscriptionsPrefsStore.getState();
  const next = moveSubscriptionProvider(providerOrder, visible, movedId, toIndex);
  if (next.join("\n") !== providerOrder.join("\n")) update({ providerOrder: next });
}

/** Adds or replaces (by id) a pretend entry; false when it is invalid or the cap is reached. */
export function savePretendSubscription(entry: PretendSubscription): boolean {
  const clean = sanitizePretendSubscription(entry);
  if (!clean) return false;
  const { pretend } = useSubscriptionsPrefsStore.getState();
  const index = pretend.findIndex((existing) => existing.id === clean.id);
  if (index < 0 && pretend.length >= MAX_PRETEND_SUBSCRIPTIONS) return false;
  update({
    pretend: index < 0 ? [...pretend, clean] : pretend.with(index, clean),
  });
  return true;
}

export function deletePretendSubscription(id: string): void {
  const { pretend, providerOrder } = useSubscriptionsPrefsStore.getState();
  const orderId = `${PRETEND_PROVIDER_PREFIX}${id}`;
  update({
    pretend: pretend.filter((entry) => entry.id !== id),
    providerOrder: providerOrder.filter((saved) => saved !== orderId),
  });
}

export function newPretendId(): string {
  return crypto.randomUUID();
}

/**
 * Adds or replaces (by key) a real account's override and drops overrides
 * of accounts not in `knownKeys` (every account the host knows, hidden ones
 * included, so a disabled account keeps its override); false when invalid.
 */
export function saveSubscriptionOverride(
  override: SubscriptionOverride,
  knownKeys: readonly string[],
): boolean {
  const clean = sanitizeSubscriptionOverride(override);
  if (!clean) return false;
  const known = new Set(knownKeys);
  const kept = useSubscriptionsPrefsStore
    .getState()
    .overrides.filter((existing) => existing.key !== clean.key && known.has(existing.key));
  update({ overrides: [...kept, clean].slice(-MAX_SUBSCRIPTION_OVERRIDES) });
  return true;
}

/** "Reset to real": the account shows its real values again. */
export function resetSubscriptionOverride(key: string): void {
  const { overrides } = useSubscriptionsPrefsStore.getState();
  update({ overrides: overrides.filter((existing) => existing.key !== key) });
}
