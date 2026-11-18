/**
 * BackgroundLayer wiring for per-project backgrounds: the controller starts
 * from, and follows, the focused project's override over the real stores.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useFxSettings, type BackgroundSettings } from "../fxSettingsStore";

const controllers = vi.hoisted(
  () => [] as { initial: BackgroundSettings; update: ReturnType<typeof vi.fn> }[],
);

vi.mock("./backgroundController", () => ({
  BackgroundController: class {
    readonly update = vi.fn<(next: BackgroundSettings) => void>();
    constructor(_host: HTMLElement, initial: BackgroundSettings) {
      controllers.push({ initial, update: this.update });
    }
    dispose() {}
    stats() {
      return {};
    }
  },
}));

import { BackgroundLayer } from "./BackgroundLayer";

const threads = [
  { id: "t-alpha", projectId: "alpha" },
  { id: "t-beta", projectId: "beta" },
] as unknown as Thread[];

/**
 * The layer reads the app store outside React, so focus changes need no
 * `act` (wrapping the real app store's updates in `act` leaves later renders
 * of this file unflushed).
 */
function focus(paneId: string): void {
  useAppStore.setState({ focusedPaneId: paneId });
}

describe("BackgroundLayer per-project backgrounds", () => {
  const initialApp = useAppStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    controllers.length = 0;
    useAppStore.setState({
      threads,
      view: { kind: "thread", panes: ["t-alpha", "t-beta"] },
      focusedPaneId: "t-alpha",
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({
      threads: initialApp.threads,
      view: initialApp.view,
      focusedPaneId: initialApp.focusedPaneId,
    });
  });

  it("starts with the focused project's override and follows focus changes", () => {
    useFxSettings.getState().setProjectBackground("alpha", { preset: "aurora", intensity: 0.3 });
    render(<BackgroundLayer />);
    expect(controllers).toHaveLength(1);
    const controller = controllers[0]!;
    expect(controller.initial).toMatchObject({ preset: "aurora", intensity: 0.3 });

    focus("t-beta");
    expect(controller.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: "mesh", intensity: 0.7 }),
    );

    act(() => useFxSettings.getState().setProjectBackground("beta", { preset: "particles" }));
    expect(controller.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: "particles", intensity: 0.7 }),
    );
    expect(controller.update).toHaveBeenCalledTimes(2);
  });

  it("does not touch the controller for store changes that keep the project", () => {
    useFxSettings.getState().setProjectBackground("alpha", { preset: "aurora" });
    render(<BackgroundLayer />);
    expect(controllers).toHaveLength(1);
    const controller = controllers[0]!;
    useAppStore.setState({ threads: [...threads] });
    act(() => useFxSettings.getState().setEffects({ typingGlow: false }));
    act(() => useFxSettings.getState().setSounds({ enabled: true }));
    expect(controller.update).not.toHaveBeenCalled();
  });
});
