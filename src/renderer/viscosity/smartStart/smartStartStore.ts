/**
 * ViscosityCode: Smart start client preferences (fork of Poracode).
 *
 * View preferences of this device (ARCHITECTURE_NOTES.md §8.6), kept in local
 * storage like `fxSettingsStore`, never in the host settings schema:
 *
 * - `autoByProject`: whether "Let ViscosityCode pick" is on for a project.
 * - `preferences`: the owner's ordered providers per task kind ("preferred
 *   for coding", "preferred for quick questions"). A kind without a list
 *   follows the last-used order.
 * - `recentProviders`: providers the owner started threads with by hand,
 *   most recent first — the default preference order.
 *
 * Providers are identified by their agent kind (a profile account's driver),
 * so nothing here knows a provider by name. Every storage access is guarded;
 * a missing, foreign-version or malformed document yields defaults.
 */
import { create } from "zustand";
import type { SmartStartTaskKind } from "./taskKind";

export const SMART_START_STORAGE_KEY = "viscosity:smartStart:v1";
export const SMART_START_STORE_VERSION = 1;

/** Most projects remembered with Auto on/off. */
const MAX_PROJECTS = 500;
/** Most providers kept in one ordered list. */
export const MAX_PREFERENCE_PROVIDERS = 32;
/** Most providers remembered as recently used. */
const MAX_RECENT_PROVIDERS = 16;
const MAX_ID_LENGTH = 200;

export type SmartStartPreferences = Partial<Record<SmartStartTaskKind, string[]>>;

export interface SmartStartDocument {
  autoByProject: Record<string, boolean>;
  preferences: SmartStartPreferences;
  recentProviders: string[];
}

export const DEFAULT_SMART_START_DOCUMENT: SmartStartDocument = {
  autoByProject: {},
  preferences: {},
  recentProviders: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/** Distinct non-empty ids, first occurrence wins, capped at `max`. */
export function normalizeIdList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (!isId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalise any stored shape into a valid document, field by field. */
export function normalizeSmartStartDocument(raw: unknown): SmartStartDocument {
  const doc = isRecord(raw) ? raw : {};
  const auto = isRecord(doc.autoByProject) ? doc.autoByProject : {};
  // fromEntries defines own keys, so a stored "__proto__" project id stays inert data.
  const autoByProject = Object.fromEntries(
    Object.entries(auto)
      .filter(
        (entry): entry is [string, boolean] => isId(entry[0]) && typeof entry[1] === "boolean",
      )
      .slice(-MAX_PROJECTS),
  );
  const storedPreferences = isRecord(doc.preferences) ? doc.preferences : {};
  const preferences: SmartStartPreferences = {};
  for (const kind of ["coding", "quick"] as const) {
    if (!Object.hasOwn(storedPreferences, kind)) continue;
    const list = storedPreferences[kind];
    if (Array.isArray(list)) preferences[kind] = normalizeIdList(list, MAX_PREFERENCE_PROVIDERS);
  }
  return {
    autoByProject,
    preferences,
    recentProviders: normalizeIdList(doc.recentProviders, MAX_RECENT_PROVIDERS),
  };
}

export function readSmartStartDocument(): SmartStartDocument {
  try {
    const raw = localStorage.getItem(SMART_START_STORAGE_KEY);
    if (!raw) return normalizeSmartStartDocument(undefined);
    const parsed = JSON.parse(raw) as { version?: unknown } | null;
    if (parsed?.version !== SMART_START_STORE_VERSION)
      return normalizeSmartStartDocument(undefined);
    return normalizeSmartStartDocument(parsed);
  } catch {
    return normalizeSmartStartDocument(undefined);
  }
}

function writeSmartStartDocument(doc: SmartStartDocument): void {
  try {
    localStorage.setItem(
      SMART_START_STORAGE_KEY,
      JSON.stringify({ version: SMART_START_STORE_VERSION, ...doc }),
    );
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

/** `recent` with `provider` moved to the front. */
export function withRecentProvider(recent: readonly string[], provider: string): string[] {
  if (!isId(provider)) return [...recent];
  return [provider, ...recent.filter((entry) => entry !== provider)].slice(0, MAX_RECENT_PROVIDERS);
}

interface SmartStartState extends SmartStartDocument {
  setAuto: (projectId: string, enabled: boolean) => void;
  /** Save an explicit order for `kind`; `null` returns it to the last-used order. */
  setPreference: (kind: SmartStartTaskKind, order: readonly string[] | null) => void;
  /** Remember that the owner started a thread with `provider` by hand. */
  recordProviderUse: (provider: string) => void;
}

function documentOf(state: SmartStartDocument): SmartStartDocument {
  return {
    autoByProject: state.autoByProject,
    preferences: state.preferences,
    recentProviders: state.recentProviders,
  };
}

export const useSmartStartStore = create<SmartStartState>()((set, get) => {
  function commit(next: SmartStartDocument): void {
    const normalized = normalizeSmartStartDocument(next);
    set(normalized);
    writeSmartStartDocument(normalized);
  }
  return {
    ...readSmartStartDocument(),
    setAuto: (projectId, enabled) => {
      if (!isId(projectId)) return;
      const current = documentOf(get());
      if (current.autoByProject[projectId] === enabled) return;
      // Re-inserting keeps the most recently changed projects when the cap trims.
      const { [projectId]: _previous, ...others } = current.autoByProject;
      commit({ ...current, autoByProject: { ...others, [projectId]: enabled } });
    },
    setPreference: (kind, order) => {
      const current = documentOf(get());
      const preferences: SmartStartPreferences = { ...current.preferences };
      if (order === null) delete preferences[kind];
      else preferences[kind] = normalizeIdList(order, MAX_PREFERENCE_PROVIDERS);
      commit({ ...current, preferences });
    },
    recordProviderUse: (provider) => {
      const current = documentOf(get());
      if (current.recentProviders[0] === provider) return;
      commit({
        ...current,
        recentProviders: withRecentProvider(current.recentProviders, provider),
      });
    },
  };
});

/** Whether Auto is on for `projectId` (narrow selector). */
export function selectAutoForProject(projectId: string | undefined) {
  return (state: SmartStartDocument): boolean =>
    projectId !== undefined &&
    Object.hasOwn(state.autoByProject, projectId) &&
    state.autoByProject[projectId] === true;
}
