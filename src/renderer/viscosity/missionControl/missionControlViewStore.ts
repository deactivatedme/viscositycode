/**
 * ViscosityCode Mission Control: whether the panel covers the center split
 * view, plus the viewer's remembered tab and filter (fork of Poracode).
 *
 * `shown` is a view state of this window only (never host state, never
 * persisted). The panel opens only on an explicit user action (activity bar,
 * palette, status bar) and steps aside as soon as the user goes elsewhere: a
 * thread, another center view, the inline editor or a Roundtable.
 * Agent activity never brings it forward.
 *
 * The tab and filter are client view preferences in localStorage, read and
 * written defensively (private mode, blocked site data).
 */
import { toast } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { create } from "zustand";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import {
  hideRoundtablePanel,
  useRoundtableViewStore,
} from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { isMissionFilter, type MissionFilter } from "./missionModel";

export const MISSION_CONTROL_PREFS_KEY = "viscosity:mission-control:v1";

/** The built-in "Agents" tab (order 0). */
export const MISSION_AGENTS_TAB_ID = "agents";

export interface MissionControlPrefs {
  /** Last selected tab id; resolved against the registered tabs when shown. */
  tabId: string | null;
  filter: MissionFilter;
}

export const DEFAULT_MISSION_CONTROL_PREFS: MissionControlPrefs = { tabId: null, filter: "all" };

const TAB_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Stored preferences; anything missing or malformed falls back to the defaults. */
export function readMissionControlPrefs(
  storage: ReadableStorage | null = defaultStorage(),
): MissionControlPrefs {
  if (!storage) return DEFAULT_MISSION_CONTROL_PREFS;
  try {
    const raw = storage.getItem(MISSION_CONTROL_PREFS_KEY);
    if (!raw) return DEFAULT_MISSION_CONTROL_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_MISSION_CONTROL_PREFS;
    const record = parsed as Record<string, unknown>;
    return {
      tabId:
        typeof record.tabId === "string" && TAB_ID_PATTERN.test(record.tabId) ? record.tabId : null,
      filter: isMissionFilter(record.filter) ? record.filter : "all",
    };
  } catch {
    return DEFAULT_MISSION_CONTROL_PREFS;
  }
}

export function writeMissionControlPrefs(
  prefs: MissionControlPrefs,
  storage: WritableStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(MISSION_CONTROL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort view preference (private mode, quota, blocked site data).
  }
}

interface MissionControlViewState extends MissionControlPrefs {
  /** Whether the panel currently covers the center split view. */
  shown: boolean;
}

export const useMissionControlViewStore = create<MissionControlViewState>()(() => ({
  shown: false,
  ...readMissionControlPrefs(),
}));

function savePrefs(): void {
  const { tabId, filter } = useMissionControlViewStore.getState();
  writeMissionControlPrefs({ tabId, filter });
}

export function setMissionControlTab(tabId: string): void {
  if (!TAB_ID_PATTERN.test(tabId) || useMissionControlViewStore.getState().tabId === tabId) return;
  useMissionControlViewStore.setState({ tabId });
  savePrefs();
}

export function setMissionControlFilter(filter: MissionFilter): void {
  if (useMissionControlViewStore.getState().filter === filter) return;
  useMissionControlViewStore.setState({ filter });
  savePrefs();
}

export function selectMissionControlShown(state: MissionControlViewState): boolean {
  return state.shown;
}

export function isMissionControlShown(): boolean {
  return useMissionControlViewStore.getState().shown;
}

/**
 * Show the panel over the split view, in front of the inline editor and an
 * open Roundtable (their tabs/state stay). User actions only.
 * Outside the desktop shell it says where the panel lives instead.
 */
export function openMissionControl(options?: { filter?: MissionFilter; tabId?: string }): void {
  if (!isViscosityShellActive()) {
    toast.info(i18n._(msg`Mission Control is available in the desktop app.`));
    return;
  }
  const editor = useFileEditorStore.getState();
  if (editor.overlayMode === "modal") editor.setOverlayMode(null);
  hideRoundtablePanel();
  if (options?.filter) setMissionControlFilter(options.filter);
  if (options?.tabId) setMissionControlTab(options.tabId);
  if (!useMissionControlViewStore.getState().shown) {
    useMissionControlViewStore.setState({ shown: true });
  }
}

/** Step aside for whatever is underneath. */
export function closeMissionControl(): void {
  if (!useMissionControlViewStore.getState().shown) return;
  useMissionControlViewStore.setState({ shown: false });
}

/** Activity bar press: show, or hide again when it is already showing. */
export function toggleMissionControl(): void {
  if (useMissionControlViewStore.getState().shown) closeMissionControl();
  else openMissionControl();
}

/**
 * Hide the panel when the user navigates elsewhere: opening a thread (any
 * `openThread` marks the pending active thread first), switching the center
 * view, showing the inline editor or a Roundtable. Installed
 * outside React by the center host; returns the unsubscribe.
 */
export function startMissionControlViewSync(): () => void {
  const unsubscribeEditor = useFileEditorStore.subscribe((state, previous) => {
    if (state.overlayMode === "modal" && previous.overlayMode !== "modal") closeMissionControl();
  });
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    const openedThread =
      state.pendingActiveThreadId !== null &&
      state.pendingActiveThreadId !== previous.pendingActiveThreadId;
    // A new-thread draft (Cmd+N, the sidebar's New thread) moves `draftVisit` even when the view kind stays.
    if (
      openedThread ||
      state.draftVisit !== previous.draftVisit ||
      state.view.kind !== previous.view.kind
    ) {
      closeMissionControl();
    }
  });
  const unsubscribeRoundtable = useRoundtableViewStore.subscribe((state, previous) => {
    if (state.shown && !previous.shown) closeMissionControl();
  });
  return () => {
    unsubscribeEditor();
    unsubscribeApp();
    unsubscribeRoundtable();
  };
}
