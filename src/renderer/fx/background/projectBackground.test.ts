import { describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { makeDraftPaneId } from "@/shared/paneId";
import {
  DEFAULT_FX_SETTINGS,
  type BackgroundSettings,
  type ProjectBackgrounds,
} from "@/renderer/fx/fxSettingsStore";
import {
  type BackgroundProjectState,
  createEffectiveBackgroundSource,
  resolveProjectBackground,
  selectBackgroundProjectId,
} from "./projectBackground";

const GLOBAL = DEFAULT_FX_SETTINGS.background;

const project = (id: string): Project => ({ id, name: id }) as Project;
const thread = (id: string, projectId: string): Thread => ({ id, projectId }) as Thread;

function state(patch: Partial<BackgroundProjectState>): BackgroundProjectState {
  return { view: { kind: "home" }, threads: [], focusedPaneId: null, projects: [], ...patch };
}

describe("resolveProjectBackground", () => {
  const overrides: ProjectBackgrounds = {
    styled: { preset: "aurora" },
    dimmed: { intensity: 0.2 },
    both: { preset: "particles", intensity: 1 },
    same: { preset: GLOBAL.preset, intensity: GLOBAL.intensity },
  };

  it("uses the global settings without a project or an override", () => {
    expect(resolveProjectBackground(GLOBAL, overrides, undefined)).toBe(GLOBAL);
    expect(resolveProjectBackground(GLOBAL, overrides, "plain")).toBe(GLOBAL);
    expect(resolveProjectBackground(GLOBAL, overrides, "toString")).toBe(GLOBAL);
    expect(resolveProjectBackground(GLOBAL, overrides, "same")).toBe(GLOBAL);
  });

  it("overrides only the fields the project sets", () => {
    expect(resolveProjectBackground(GLOBAL, overrides, "styled")).toEqual({
      ...GLOBAL,
      preset: "aurora",
    });
    expect(resolveProjectBackground(GLOBAL, overrides, "dimmed")).toEqual({
      ...GLOBAL,
      intensity: 0.2,
    });
    const both = resolveProjectBackground({ ...GLOBAL, fpsCap: 60 }, overrides, "both");
    expect(both).toMatchObject({ preset: "particles", intensity: 1, fpsCap: 60 });
  });
});

describe("selectBackgroundProjectId", () => {
  const threads = [thread("t1", "alpha"), thread("t2", "beta")];

  it("follows the focused pane's thread", () => {
    const view = { kind: "thread" as const, panes: ["t1", "t2"] as [string, string] };
    expect(selectBackgroundProjectId(state({ view, threads, focusedPaneId: "t2" }))).toBe("beta");
    // No focus yet: the first pane.
    expect(selectBackgroundProjectId(state({ view, threads }))).toBe("alpha");
  });

  it("uses the project of a draft pane or a full-page draft", () => {
    const draftPane = makeDraftPaneId("gamma");
    const view = { kind: "thread" as const, panes: [draftPane] as [string] };
    expect(selectBackgroundProjectId(state({ view, threads, focusedPaneId: draftPane }))).toBe(
      "gamma",
    );
    expect(selectBackgroundProjectId(state({ view: { kind: "draft", projectId: "delta" } }))).toBe(
      "delta",
    );
  });

  it("uses the Home project on the Home page, and nothing elsewhere", () => {
    const projects = [project("alpha"), project(HOME_PROJECT_ID)];
    expect(selectBackgroundProjectId(state({ projects }))).toBe(HOME_PROJECT_ID);
    expect(selectBackgroundProjectId(state({ projects: [project("alpha")] }))).toBeUndefined();
    expect(selectBackgroundProjectId(state({ view: { kind: "schedules" }, projects }))).toBe(
      undefined,
    );
  });
});

function sourceHarness(initialProject: string | undefined, overrides: ProjectBackgrounds) {
  let fx = { background: GLOBAL, projectBackgrounds: overrides };
  let projectId = initialProject;
  const fxListeners = new Set<() => void>();
  const projectListeners = new Set<() => void>();
  const source = createEffectiveBackgroundSource({
    getFx: () => fx,
    subscribeFx: (listener) => {
      fxListeners.add(listener);
      return () => fxListeners.delete(listener);
    },
    getProjectId: () => projectId,
    subscribeProjectId: (listener) => {
      projectListeners.add(listener);
      return () => projectListeners.delete(listener);
    },
  });
  return {
    source,
    setFx(patch: Partial<typeof fx>) {
      fx = { ...fx, ...patch };
      for (const listener of fxListeners) listener();
    },
    focus(next: string | undefined) {
      projectId = next;
      for (const listener of projectListeners) listener();
    },
    listenerCount: () => fxListeners.size + projectListeners.size,
  };
}

describe("createEffectiveBackgroundSource", () => {
  it("switches style and intensity as focus moves between projects", () => {
    const h = sourceHarness("plain", { aurora: { preset: "aurora", intensity: 0.3 } });
    expect(h.source.get()).toBe(GLOBAL);
    const updates: BackgroundSettings[] = [];
    h.source.subscribe((next) => updates.push(next));

    h.focus("aurora");
    expect(updates.at(-1)).toMatchObject({ preset: "aurora", intensity: 0.3 });
    h.focus("plain");
    expect(updates.at(-1)).toBe(GLOBAL);
    expect(updates).toHaveLength(2);
  });

  it("stays quiet when the effective settings do not change", () => {
    const h = sourceHarness("plain", { styled: { preset: "aurora" } });
    h.source.get();
    const listener = vi.fn<(next: BackgroundSettings) => void>();
    h.source.subscribe(listener);

    h.focus("other-plain"); // still global
    h.focus(undefined); // still global
    h.setFx({ projectBackgrounds: { styled: { preset: "aurora" }, more: { intensity: 0.1 } } });
    expect(listener).not.toHaveBeenCalled();

    // A global style change does not reach a project that overrides the style.
    h.focus("styled");
    expect(listener).toHaveBeenCalledTimes(1);
    h.setFx({ background: { ...GLOBAL, preset: "particles" } });
    expect(listener).toHaveBeenCalledTimes(1);
    // A global intensity change does, since the project keeps the global intensity.
    h.setFx({ background: { ...GLOBAL, preset: "particles", intensity: 0.1 } });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({ preset: "aurora", intensity: 0.1 });
  });

  it("applies an override edited while its project is in focus, and its removal", () => {
    const h = sourceHarness("p", {});
    h.source.get();
    const updates: BackgroundSettings[] = [];
    const unsubscribe = h.source.subscribe((next) => updates.push(next));
    h.setFx({ projectBackgrounds: { p: { intensity: 0.95 } } });
    expect(updates.at(-1)?.intensity).toBe(0.95);
    h.setFx({ projectBackgrounds: {} });
    expect(updates.at(-1)).toBe(GLOBAL);
    unsubscribe();
    expect(h.listenerCount()).toBe(0);
  });
});
