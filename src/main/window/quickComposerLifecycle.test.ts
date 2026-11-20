// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
// Focused regression for the shared quick-composer device lifecycle used by
// managed and standalone attach: pending submit flush (no loss while main is
// loading/closed, no duplicates), graceful dismiss with main reveal,
// toggle create/show/dismiss, file-picker focus, and quit teardown. Effects
// are observed through the injected host, never through Electron.
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickComposerSubmission } from "@/shared/ipc";
import {
  QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS,
  QUICK_COMPOSER_SUBMIT_RECEIPT_WINDOW_MS,
  QuickComposerLifecycle,
  type QuickComposerLifecycleHost,
} from "./quickComposerLifecycle";

interface FakeWindow {
  destroyed: boolean;
  visible: boolean;
  closes: number;
  asBrowserWindow(): BrowserWindow;
}

function fakeWindow(): FakeWindow {
  const state = { destroyed: false, visible: false, closes: 0 };
  return {
    get closes() {
      return state.closes;
    },
    get destroyed() {
      return state.destroyed;
    },
    set destroyed(value: boolean) {
      state.destroyed = value;
    },
    get visible() {
      return state.visible;
    },
    set visible(value: boolean) {
      state.visible = value;
    },
    asBrowserWindow() {
      return {
        isDestroyed: () => state.destroyed,
        isVisible: () => state.visible,
        close: () => {
          state.closes += 1;
          state.destroyed = true;
        },
      } as unknown as BrowserWindow;
    },
  };
}

function submission(): QuickComposerSubmission {
  return {
    projectId: "project-1",
    input: { agentKind: "codex", config: { model: "gpt-5" }, prompt: "hi" },
  } as unknown as QuickComposerSubmission;
}

interface Harness {
  lifecycle: QuickComposerLifecycle;
  host: QuickComposerLifecycleHost & {
    delivered: { window: BrowserWindow; submission: QuickComposerSubmission }[];
    shown: BrowserWindow[];
    revealed: BrowserWindow[];
    dismissRequested: BrowserWindow[];
    hidden: BrowserWindow[];
    createdOverlays: BrowserWindow[];
  };
  main: FakeWindow;
  overlay: FakeWindow;
  mainMissing: { current: boolean };
}

function harness(): Harness {
  const main = fakeWindow();
  const overlay = fakeWindow();
  const mainMissing = { current: false };
  const createdOverlays: BrowserWindow[] = [];
  const host = {
    delivered: [] as { window: BrowserWindow; submission: QuickComposerSubmission }[],
    shown: [] as BrowserWindow[],
    revealed: [] as BrowserWindow[],
    dismissRequested: [] as BrowserWindow[],
    hidden: [] as BrowserWindow[],
    createdOverlays,
    getMainWindow: () => (mainMissing.current ? null : main.asBrowserWindow()),
    getOverlay: () => overlay.asBrowserWindow(),
    setOverlay: (window: BrowserWindow | null) => {
      if (window) createdOverlays.push(window);
    },
    createOverlay: () => overlay.asBrowserWindow(),
    ensureMainWindow: () => {
      mainMissing.current = false;
      return main.asBrowserWindow();
    },
    showOverlay: (window: BrowserWindow) => {
      host.shown.push(window);
    },
    revealMainWindow: (window: BrowserWindow) => {
      host.revealed.push(window);
    },
    deliverSubmission: (window: BrowserWindow, next: QuickComposerSubmission) => {
      host.delivered.push({ window, submission: next });
    },
    requestOverlayDismiss: (window: BrowserWindow) => {
      host.dismissRequested.push(window);
    },
    hideOverlay: (window: BrowserWindow) => {
      host.hidden.push(window);
    },
    pickFiles: async () => ["picked.ts"],
  };
  return { lifecycle: new QuickComposerLifecycle(host), host, main, overlay, mainMissing };
}

describe("quick composer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a submit while main is missing and delivers once on ready", () => {
    const { lifecycle, host, overlay, mainMissing } = harness();
    mainMissing.current = true;
    lifecycle.handleSubmit(overlay.asBrowserWindow(), submission());
    expect(host.delivered).toEqual([]);
    expect(lifecycle.pendingCount()).toBe(1);
    lifecycle.handleMainReady();
    expect(host.delivered).toHaveLength(1);
    expect(host.delivered[0]?.submission).toMatchObject({ projectId: "project-1" });
    expect(lifecycle.pendingCount()).toBe(0);
  });

  it("holds a submit until the ready ping and never duplicates it", () => {
    const { lifecycle, host, overlay } = harness();
    lifecycle.handleSubmit(overlay.asBrowserWindow(), submission());
    expect(host.delivered).toEqual([]);
    lifecycle.handleMainReady();
    expect(host.delivered).toHaveLength(1);
    lifecycle.handleMainReady();
    expect(host.delivered).toHaveLength(1);
  });

  it("dismisses gracefully after submit and reveals the recreated main", async () => {
    const { lifecycle, host, overlay } = harness();
    lifecycle.handleSubmit(overlay.asBrowserWindow(), submission());
    lifecycle.handleMainReady();
    // Graceful round-trip first: the overlay is asked to dismiss itself.
    expect(host.dismissRequested).toEqual([]);
    expect(host.hidden).toEqual([]);
    await vi.advanceTimersByTimeAsync(800);
    expect(host.dismissRequested).toEqual([]);
    expect(host.hidden).toHaveLength(1);
    expect(host.revealed).toHaveLength(1);
  });

  it("requests a graceful dismiss on toggle of a visible overlay", async () => {
    const { lifecycle, host, overlay } = harness();
    overlay.visible = true;
    lifecycle.toggle();
    expect(host.dismissRequested).toHaveLength(1);
    expect(host.hidden).toEqual([]);
    await vi.advanceTimersByTimeAsync(240);
    expect(host.hidden).toHaveLength(1);
    // No submit happened, so main is not revealed.
    expect(host.revealed).toEqual([]);
  });

  it("shows a hidden overlay on toggle and creates one when absent", () => {
    const { lifecycle, host, overlay } = harness();
    overlay.visible = false;
    lifecycle.toggle();
    expect(host.shown).toHaveLength(1);
    overlay.destroyed = true;
    lifecycle.toggle();
    expect(host.createdOverlays).toHaveLength(1);
  });

  it("suppresses blur-dismiss while the picker is open and refocuses after", async () => {
    const { lifecycle, host, overlay } = harness();
    let openDuringPick = false;
    host.pickFiles = async () => {
      openDuringPick = lifecycle.isDialogOpen();
      return ["picked.ts"];
    };
    overlay.visible = true;
    await expect(lifecycle.handlePickFiles(overlay.asBrowserWindow())).resolves.toEqual([
      "picked.ts",
    ]);
    expect(openDuringPick).toBe(true);
    expect(lifecycle.isDialogOpen()).toBe(false);
    expect(host.shown).toHaveLength(1);
  });

  it("does not reshow a hidden overlay after picking", async () => {
    const { lifecycle, host, overlay } = harness();
    overlay.visible = false;
    await expect(lifecycle.handlePickFiles(overlay.asBrowserWindow())).resolves.toEqual([
      "picked.ts",
    ]);
    expect(host.shown).toEqual([]);
  });

  // ViscosityCode: the hidden overlay's renderer is freed after 2 minutes idle.
  it("closes a hidden overlay after the idle delay and recreates it on toggle", async () => {
    const { lifecycle, host, overlay } = harness();
    lifecycle.finishDismiss(overlay.asBrowserWindow());
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS - 1);
    expect(overlay.closes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(overlay.closes).toBe(1);
    lifecycle.toggle();
    expect(host.createdOverlays).toHaveLength(1);
  });

  it("keeps an overlay that is shown again before the idle delay", async () => {
    const { lifecycle, overlay } = harness();
    lifecycle.finishDismiss(overlay.asBrowserWindow());
    await vi.advanceTimersByTimeAsync(60_000);
    lifecycle.toggle(); // re-show the hidden overlay
    overlay.visible = true;
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS * 2);
    expect(overlay.closes).toBe(0);
  });

  it("does not close a visible overlay when the idle timer fires", async () => {
    const { lifecycle, overlay } = harness();
    lifecycle.finishDismiss(overlay.asBrowserWindow());
    overlay.visible = true; // shown by a path other than toggle
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS);
    expect(overlay.closes).toBe(0);
  });

  it("waits for an open picker or queued work before closing", async () => {
    const { lifecycle, host, overlay } = harness();
    let finishPick: (paths: string[] | null) => void = () => {};
    host.pickFiles = () =>
      new Promise((resolve) => {
        finishPick = resolve;
      });
    const pick = lifecycle.handlePickFiles(overlay.asBrowserWindow());
    lifecycle.finishDismiss(overlay.asBrowserWindow());
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS);
    expect(overlay.closes).toBe(0);
    finishPick(null);
    await pick;

    // Main has not sent its ready ping, so the submit stays queued.
    lifecycle.handleSubmit(overlay.asBrowserWindow(), submission());
    await vi.advanceTimersByTimeAsync(800); // submit dismiss re-arms the idle timer
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS);
    expect(lifecycle.pendingCount()).toBe(1);
    expect(overlay.closes).toBe(0);

    lifecycle.handleMainReady();
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_SUBMIT_RECEIPT_WINDOW_MS);
    expect(overlay.closes).toBe(1);
  });

  // ViscosityCode: the overlay renderer awaits the launch receipt after main
  // has flushed the submit; closing it would lose the failure/uncertain notice.
  it("keeps a hidden overlay while a submit may still await its receipt", async () => {
    const { lifecycle, overlay } = harness();
    lifecycle.handleMainReady();
    lifecycle.handleSubmit(overlay.asBrowserWindow(), submission());
    expect(lifecycle.pendingCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(800 + QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS);
    expect(overlay.closes).toBe(0);
    await vi.advanceTimersByTimeAsync(
      QUICK_COMPOSER_SUBMIT_RECEIPT_WINDOW_MS - QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS * 2,
    );
    expect(overlay.closes).toBe(0);
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS * 2);
    expect(overlay.closes).toBe(1);
  });

  it("cancels the idle close on dispose", async () => {
    const { lifecycle, overlay } = harness();
    lifecycle.finishDismiss(overlay.asBrowserWindow());
    lifecycle.dispose();
    await vi.advanceTimersByTimeAsync(QUICK_COMPOSER_IDLE_CLOSE_DELAY_MS);
    expect(overlay.closes).toBe(0);
  });

  it("drops pending work on dispose without delivering", () => {
    const { lifecycle, host, overlay, mainMissing } = harness();
    mainMissing.current = true;
    lifecycle.handleSubmit(overlay.asBrowserWindow(), submission());
    lifecycle.dispose();
    lifecycle.handleMainReady();
    expect(host.delivered).toEqual([]);
    expect(lifecycle.pendingCount()).toBe(0);
  });
});
