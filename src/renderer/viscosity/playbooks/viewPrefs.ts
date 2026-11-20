/**
 * ViscosityCode: device-local view preferences for Playbooks.
 *
 * Whether a playbook may restyle the app with its theme. The retired
 * `switchAnimation` and `crtScanlines` switches (their effects were removed)
 * are still read and written so the stored document round-trips unchanged for
 * an older build; nothing acts on them. View preferences, so they live in this browser's local
 * storage (HANDOFF: `viscosity:*:v1`), not the host settings document. A
 * missing, malformed, foreign-version or unavailable document yields defaults.
 * The playbook theme layer reads these through the getters or the hook.
 */
import { create } from "zustand";

export const PLAYBOOK_VIEW_PREFS_STORAGE_KEY = "viscosity:playbooks-view:v1";
export const PLAYBOOK_VIEW_PREFS_VERSION = 1;

/** Dispatched on `window` after every write, for readers outside this store. */
export const PLAYBOOK_VIEW_PREFS_EVENT = "viscosity:playbooks-view-changed";

export interface PlaybookViewPrefs {
  /** "Let playbooks change the theme": a chat's playbook may restyle the app while on screen. */
  themeOverride: boolean;
  /** Retired "Theme switch animation" switch; kept for round-tripping only. */
  switchAnimation: boolean;
  /** Retired "CRT scanlines" switch; kept for round-tripping only. */
  crtScanlines: boolean;
}

export const DEFAULT_PLAYBOOK_VIEW_PREFS: PlaybookViewPrefs = {
  // Off unless the user turns it on; a stored value (either way) keeps winning.
  themeOverride: false,
  switchAnimation: true,
  crtScanlines: false,
};

const PREF_KEYS = Object.keys(DEFAULT_PLAYBOOK_VIEW_PREFS) as (keyof PlaybookViewPrefs)[];

export function normalizePlaybookViewPrefs(raw: unknown): PlaybookViewPrefs {
  const doc = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<string, unknown>>;
  const prefs = { ...DEFAULT_PLAYBOOK_VIEW_PREFS };
  for (const key of PREF_KEYS) {
    const value = doc[key];
    if (typeof value === "boolean") prefs[key] = value;
  }
  return prefs;
}

function prefsOf(state: PlaybookViewPrefs): PlaybookViewPrefs {
  return normalizePlaybookViewPrefs(state);
}

export function readPlaybookViewPrefs(): PlaybookViewPrefs {
  try {
    const raw = localStorage.getItem(PLAYBOOK_VIEW_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLAYBOOK_VIEW_PREFS };
    const parsed = JSON.parse(raw) as { version?: unknown } | null;
    if (parsed?.version !== PLAYBOOK_VIEW_PREFS_VERSION) return { ...DEFAULT_PLAYBOOK_VIEW_PREFS };
    return normalizePlaybookViewPrefs(parsed);
  } catch {
    return { ...DEFAULT_PLAYBOOK_VIEW_PREFS };
  }
}

interface PlaybookViewPrefsState extends PlaybookViewPrefs {
  setPrefs: (patch: Partial<PlaybookViewPrefs>) => void;
}

export const usePlaybookViewPrefsStore = create<PlaybookViewPrefsState>()((set, get) => ({
  ...readPlaybookViewPrefs(),
  setPrefs: (patch) => {
    const next = normalizePlaybookViewPrefs({ ...prefsOf(get()), ...patch });
    set(next);
    try {
      localStorage.setItem(
        PLAYBOOK_VIEW_PREFS_STORAGE_KEY,
        JSON.stringify({ version: PLAYBOOK_VIEW_PREFS_VERSION, ...next }),
      );
    } catch {
      // The change still applies for this session.
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PLAYBOOK_VIEW_PREFS_EVENT));
  },
}));

// Another window of this app changed the switches.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === PLAYBOOK_VIEW_PREFS_STORAGE_KEY) {
      usePlaybookViewPrefsStore.setState(readPlaybookViewPrefs());
    }
  });
}

export function getPlaybookViewPrefs(): PlaybookViewPrefs {
  return prefsOf(usePlaybookViewPrefsStore.getState());
}

export function isPlaybookThemeEnabled(): boolean {
  return usePlaybookViewPrefsStore.getState().themeOverride;
}

export function setPlaybookViewPrefs(patch: Partial<PlaybookViewPrefs>): void {
  usePlaybookViewPrefsStore.getState().setPrefs(patch);
}

/** Calls `listener` with the new preferences whenever one changes. Returns unsubscribe. */
export function subscribePlaybookViewPrefs(
  listener: (prefs: PlaybookViewPrefs) => void,
): () => void {
  return usePlaybookViewPrefsStore.subscribe((state, previous) => {
    if (PREF_KEYS.every((key) => state[key] === previous[key])) return;
    listener(prefsOf(state));
  });
}

/** React subscription to one preference. */
export function usePlaybookViewPref<K extends keyof PlaybookViewPrefs>(
  key: K,
): PlaybookViewPrefs[K] {
  return usePlaybookViewPrefsStore((state) => state[key]);
}
