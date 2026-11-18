/**
 * The marked hook in upstream `notifications.ts`: its single notification
 * sound is skipped while this window's sound pack runs and is switched on, so
 * an agent event never sounds twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sharedSettings, toastMock } = vi.hoisted(() => ({
  sharedSettings: {
    notificationsEnabled: true,
    notificationSound: true,
    notificationFilter: "all",
    notificationStatuses: { done: true, needsAttention: true, error: true },
  },
  toastMock: {
    close: vi.fn<(id: unknown) => void>(),
    danger: vi.fn<(title: string, options: unknown) => void>(),
    success: vi.fn<(title: string, options: unknown) => void>(),
    warning: vi.fn<(title: string, options: unknown) => void>(),
  },
}));

vi.mock("@heroui/react", () => ({ toast: toastMock }));
vi.mock("@/renderer/actions/threadActions", () => ({ openThread: vi.fn<() => void>() }));
vi.mock("@/renderer/actions/threadWindowActions", () => ({
  openThreadWindow: vi.fn<() => void>(),
}));
vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: { getState: () => sharedSettings },
}));

import { showUserNotification } from "@/renderer/notifications";
import { useFxSettings } from "@/renderer/fx/fxSettingsStore";
import { markSoundPackRunning } from "./soundPackState";

function notify(): void {
  showUserNotification({
    threadId: "background-thread",
    category: "done",
    projectName: "Repo",
    threadTitle: "Thread",
    status: "idle",
  });
}

describe("notification sound with the sound pack", () => {
  let play: ReturnType<typeof vi.spyOn>;
  const releases: (() => void)[] = [];

  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    for (const release of releases.splice(0)) release();
    vi.restoreAllMocks();
  });

  it("keeps upstream's sound while the pack is off or not running here", () => {
    notify();
    expect(toastMock.success).toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);

    // Switched on, but no pack runs in this window (compact layout, other window).
    useFxSettings.getState().setSounds({ enabled: true });
    notify();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("skips upstream's sound while the pack runs and is on, but still shows the toast", () => {
    releases.push(markSoundPackRunning());
    useFxSettings.getState().setSounds({ enabled: true });
    toastMock.success.mockClear();
    notify();
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });
});
