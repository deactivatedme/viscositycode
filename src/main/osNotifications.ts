// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { BrowserWindow, Notification } from "electron"; // ViscosityCode: BrowserWindow.getFocusedWindow
import { IPC_EVENT_CHANNELS } from "@/shared/ipc";
import type { ShowNotificationPayload } from "@/shared/ipc/schemas";
import type { ThreadStatus } from "@/shared/contracts";
import type { UserNotification, UserNotificationCategory } from "@/shared/threadNotification";
import { showAndFocusWindow } from "./window/showAndFocusWindow";
import { findThreadWindow, isThreadWindow } from "./window/threadWindows"; // ViscosityCode: isThreadWindow

// Electron's Notification is a thin JS wrapper over a native object. If the
// wrapper is garbage-collected before the user interacts, its "click" listener
// is lost and the click never routes back to the renderer. Retain each shown
// notification until it is closed, fails, or is clicked.
const liveNotifications = new Set<Notification>();

/**
 * Show an OS notification from the main process. This uses Electron's native
 * Notification API, which — unlike the renderer's Web Notification API — is not
 * gated by Chromium's per-session permission handler, so it works regardless of
 * the app's `setPermissionCheckHandler` policy. Clicking the notification
 * focuses the main window and asks the renderer to open the originating thread,
 * or focuses the thread's own window when it has one.
 */
export function showOsNotification(
  payload: ShowNotificationPayload,
  getMainWindow: () => BrowserWindow | null,
  openThread?: (threadId: string) => void,
): boolean {
  if (!Notification.isSupported()) return false;
  if (isUserViewingThread(payload, getMainWindow)) return false; // ViscosityCode

  let notification: Notification;
  try {
    notification = new Notification({
      title: payload.title,
      body: payload.body,
      // The renderer plays its own notification sound; keep the OS notification
      // silent so the two don't double up.
      silent: true,
    });
  } catch {
    return false;
  }
  liveNotifications.add(notification);

  const release = (): void => {
    liveNotifications.delete(notification);
  };
  notification.on("close", release);
  notification.on("failed", release);
  notification.on("click", () => {
    release();
    const threadWindow = findThreadWindow(payload.threadId);
    if (threadWindow) {
      showAndFocusWindow(threadWindow);
      return;
    }
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      openThread?.(payload.threadId);
      return;
    }
    showAndFocusWindow(win);
    win.webContents.send(IPC_EVENT_CHANNELS.threadOpenRequested, {
      threadId: payload.threadId,
      source: "notification",
    });
  });

  try {
    notification.show();
  } catch {
    release();
    return false;
  }
  return true;
}

/**
 * ViscosityCode: the user is already looking at this thread, in its own
 * focused window or in the main window while another window of this app has
 * focus. Shared by the OS banner and the sound pack (only main can tell).
 */
export function isUserViewingThread(
  payload: Pick<ShowNotificationPayload, "threadId" | "shownInMainWindow">,
  getMainWindow: () => BrowserWindow | null,
): boolean {
  if (findThreadWindow(payload.threadId)?.isFocused()) return true;
  return payload.shownInMainWindow === true && isAppWindowFocused(getMainWindow());
}

/**
 * ViscosityCode: the renderer shows the thread in the main window but has lost
 * document focus to another window of this app (the quick composer, DevTools).
 * The user is still here, so no banner. A thread window does not count: it can
 * cover the main window. Another app in front leaves every app window
 * unfocused, and the banner shows.
 */
function isAppWindowFocused(main: BrowserWindow | null): boolean {
  if (!main || main.isDestroyed() || main.isMinimized()) return false;
  const focused = BrowserWindow.getFocusedWindow();
  return (focused !== null && !isThreadWindow(focused)) || main.webContents.isDevToolsFocused();
}

/**
 * Zero-window desktop fallback (G2.4): thread notifications normally surface
 * through the mounted renderer (localized Web Notification + toast + sound).
 * With no renderer mounted (tray/hidden mode) nothing would show at all, so
 * main shows the OS notification itself. English-only detail strings match
 * the backend-composed `notify-user` payload precedent; main does not load
 * the renderer i18n catalogs.
 */
export function showUserNotificationFallback(
  notification: UserNotification,
  getMainWindow: () => BrowserWindow | null,
  openThread?: (threadId: string) => void,
): boolean {
  return showOsNotification(
    {
      title: notification.projectName,
      body: `${notification.threadTitle}\n${statusDetail(notification.category, notification.status)}`,
      threadId: notification.threadId,
    },
    getMainWindow,
    openThread,
  );
}

function statusDetail(category: UserNotificationCategory, status: ThreadStatus): string {
  switch (category) {
    case "done":
      return status === "finished"
        ? "Finished · Waiting for your input"
        : "Done · Waiting for your input";
    case "needsAttention":
      return status === "needs_approval"
        ? "Needs Attention · Approval required"
        : "Needs Attention · Reply required";
    case "error":
      return "Error · Agent encountered an error";
  }
}
