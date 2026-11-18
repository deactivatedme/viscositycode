/**
 * ViscosityCode: client preferences for per-agent accent colours.
 *
 * View preferences, so they live in this browser's local storage rather than
 * the host settings document (ARCHITECTURE_NOTES.md §8.6). Every storage
 * access is guarded; a missing, malformed, foreign-version or unavailable
 * document yields defaults. Only the owner's picks are stored: automatic
 * colours are derived (assignment.ts), so they follow newly installed agents.
 */
import { create } from "zustand";
import { isAgentColorId, type AgentColorId } from "./palette";

export const AGENT_COLORS_STORAGE_KEY = "viscosity:agent-colors:v1";
export const AGENT_COLORS_VERSION = 1;

/** Bounds a corrupted or hostile document can not exceed. */
const MAX_OVERRIDES = 256;
const MAX_KIND_LENGTH = 200;

export interface AgentColorsPrefs {
  /** Colour pane headers, tabs and sidebar threads by agent. */
  enabled: boolean;
  /** The owner's picks, by agent kind. */
  colors: Record<string, AgentColorId>;
}

export const DEFAULT_AGENT_COLORS_PREFS: AgentColorsPrefs = { enabled: true, colors: {} };

function isStorableKind(kind: string): boolean {
  return kind.length > 0 && kind.length <= MAX_KIND_LENGTH;
}

/** Normalise any stored shape into valid preferences, entry by entry. */
export function normalizeAgentColorsPrefs(raw: unknown): AgentColorsPrefs {
  const doc = (raw && typeof raw === "object" ? raw : {}) as {
    enabled?: unknown;
    colors?: unknown;
  };
  const colors: Record<string, AgentColorId> = {};
  if (doc.colors && typeof doc.colors === "object" && !Array.isArray(doc.colors)) {
    let count = 0;
    for (const [kind, color] of Object.entries(doc.colors as Record<string, unknown>)) {
      if (count >= MAX_OVERRIDES) break;
      if (!isStorableKind(kind) || !isAgentColorId(color)) continue;
      colors[kind] = color;
      count += 1;
    }
  }
  return {
    enabled: typeof doc.enabled === "boolean" ? doc.enabled : DEFAULT_AGENT_COLORS_PREFS.enabled,
    colors,
  };
}

export function readAgentColorsPrefs(): AgentColorsPrefs {
  try {
    const raw = localStorage.getItem(AGENT_COLORS_STORAGE_KEY);
    if (!raw) return normalizeAgentColorsPrefs(undefined);
    const parsed = JSON.parse(raw) as { version?: unknown } | null;
    if (parsed?.version !== AGENT_COLORS_VERSION) return normalizeAgentColorsPrefs(undefined);
    return normalizeAgentColorsPrefs(parsed);
  } catch {
    return normalizeAgentColorsPrefs(undefined);
  }
}

function writeAgentColorsPrefs(prefs: AgentColorsPrefs): void {
  try {
    localStorage.setItem(
      AGENT_COLORS_STORAGE_KEY,
      JSON.stringify({ version: AGENT_COLORS_VERSION, ...prefs }),
    );
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

interface AgentColorsState extends AgentColorsPrefs {
  setEnabled: (enabled: boolean) => void;
  setColor: (kind: string, color: AgentColorId) => void;
  /** Back to the automatic (or inherited) colour. */
  resetColor: (kind: string) => void;
  reset: () => void;
}

export const useAgentColors = create<AgentColorsState>()((set, get) => {
  function commit(next: AgentColorsPrefs): void {
    const normalized = normalizeAgentColorsPrefs(next);
    set(normalized);
    writeAgentColorsPrefs(normalized);
  }
  return {
    ...readAgentColorsPrefs(),
    setEnabled: (enabled) => {
      if (get().enabled === enabled) return;
      commit({ enabled, colors: get().colors });
    },
    setColor: (kind, color) => {
      const { enabled, colors } = get();
      if (!isStorableKind(kind) || colors[kind] === color) return;
      commit({ enabled, colors: { ...colors, [kind]: color } });
    },
    resetColor: (kind) => {
      const { enabled, colors } = get();
      if (!Object.hasOwn(colors, kind)) return;
      const next = { ...colors };
      delete next[kind];
      commit({ enabled, colors: next });
    },
    reset: () => commit(DEFAULT_AGENT_COLORS_PREFS),
  };
});
