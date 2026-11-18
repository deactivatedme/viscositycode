/**
 * ViscosityCode: per-project backgrounds (Step 5). A project may override the
 * background's style and/or intensity; the layer uses the override of the
 * project in focus — the focused pane's thread or draft, the full-page draft
 * or experiment, or the Home project on the Home page — and the global
 * setting otherwise. Every other background setting stays global.
 *
 * The project in focus is read outside React with a primitive selector, so
 * streaming deltas never wake the controller; it is only updated when the
 * effective settings actually change.
 */
import type { AppView, Project, Thread } from "@/shared/contracts";
import { isHomeProject } from "@/shared/homeScope";
import { selectCurrentProjectIdForView } from "@/renderer/actions/currentProject";
import {
  useFxSettings,
  type BackgroundSettings,
  type ProjectBackgrounds,
} from "@/renderer/fx/fxSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";

/** The global settings with the project's override applied (the same object when none applies). */
export function resolveProjectBackground(
  global: BackgroundSettings,
  overrides: ProjectBackgrounds,
  projectId: string | undefined,
): BackgroundSettings {
  if (!projectId || !Object.hasOwn(overrides, projectId)) return global;
  const override = overrides[projectId];
  if (!override) return global;
  const preset = override.preset ?? global.preset;
  const intensity = override.intensity ?? global.intensity;
  if (preset === global.preset && intensity === global.intensity) return global;
  return { ...global, preset, intensity };
}

export interface BackgroundProjectState {
  view: AppView;
  threads: readonly Thread[];
  focusedPaneId: string | null;
  projects: readonly Project[];
}

const homeProjectIdCache = new WeakMap<readonly Project[], string | null>();

function homeProjectId(projects: readonly Project[]): string | undefined {
  let id = homeProjectIdCache.get(projects);
  if (id === undefined) {
    id = projects.find((project) => isHomeProject(project))?.id ?? null;
    homeProjectIdCache.set(projects, id);
  }
  return id ?? undefined;
}

/** The project whose background applies; O(1) per store change (cached lookups). */
export function selectBackgroundProjectId(state: BackgroundProjectState): string | undefined {
  const projectId = selectCurrentProjectIdForView(state);
  if (projectId !== undefined) return projectId;
  return state.view.kind === "home" ? homeProjectId(state.projects) : undefined;
}

function sameBackground(a: BackgroundSettings, b: BackgroundSettings): boolean {
  return (Object.keys(a) as (keyof BackgroundSettings)[]).every((key) => a[key] === b[key]);
}

export interface EffectiveBackgroundDeps {
  getFx(): { background: BackgroundSettings; projectBackgrounds: ProjectBackgrounds };
  /** Calls back when either the background or the overrides change. */
  subscribeFx(listener: () => void): () => void;
  getProjectId(): string | undefined;
  /** Calls back when the project in focus changes. */
  subscribeProjectId(listener: () => void): () => void;
}

export interface EffectiveBackgroundSource {
  get(): BackgroundSettings;
  /** Listen for effective changes only; returns the unsubscribe. */
  subscribe(listener: (next: BackgroundSettings) => void): () => void;
}

const appEffectiveBackgroundDeps: EffectiveBackgroundDeps = {
  getFx: () => useFxSettings.getState(),
  subscribeFx: (listener) =>
    useFxSettings.subscribe((state, previous) => {
      if (
        state.background !== previous.background ||
        state.projectBackgrounds !== previous.projectBackgrounds
      ) {
        listener();
      }
    }),
  getProjectId: () => selectBackgroundProjectId(useAppStore.getState()),
  subscribeProjectId: (listener) =>
    useAppStore.subscribe(selectBackgroundProjectId, () => listener()),
};

export function createEffectiveBackgroundSource(
  deps: EffectiveBackgroundDeps = appEffectiveBackgroundDeps,
): EffectiveBackgroundSource {
  function compute(): BackgroundSettings {
    const { background, projectBackgrounds } = deps.getFx();
    return resolveProjectBackground(background, projectBackgrounds, deps.getProjectId());
  }
  // The value the consumer last received, from `get` or a notification.
  let current: BackgroundSettings | null = null;
  return {
    get() {
      current = compute();
      return current;
    },
    subscribe(listener) {
      const recompute = () => {
        const next = compute();
        if (current && (next === current || sameBackground(next, current))) return;
        current = next;
        listener(next);
      };
      const unsubscribeFx = deps.subscribeFx(recompute);
      const unsubscribeProject = deps.subscribeProjectId(recompute);
      return () => {
        unsubscribeFx();
        unsubscribeProject();
      };
    },
  };
}
