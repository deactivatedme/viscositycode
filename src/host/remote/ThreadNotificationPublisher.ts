// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { Thread } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import {
  classifyThreadNotification,
  shouldPublishThreadNotification,
  type UserNotification,
} from "@/shared/threadNotification";
import { threadAttentionStatus } from "@/shared/threadAttention";

export interface ThreadNotificationPublisherOptions {
  getThread(threadId: string): Thread | null;
  getProjectName(projectId: string): string;
  getSettings(): {
    readonly notificationsEnabled: boolean;
    readonly notificationStatuses: {
      readonly done: boolean;
      readonly needsAttention: boolean;
      readonly error: boolean;
    };
    readonly notifyL2Cli: boolean;
  };
  publish(notification: UserNotification): void;
  /**
   * ViscosityCode: account pools. Asked before an "error" notification is
   * published: undefined publishes it now; a promise holds it and resolves
   * true to publish or false to drop it (the thread moved on to another
   * account). The implementation bounds the hold.
   */
  holdErrorNotification?(threadId: string, agentKind?: string): Promise<boolean> | undefined;
}

/**
 * Host-owned thread notification decisions. Clients only display what this
 * publisher emits; they must not re-classify supervisor `thread-state`.
 */
export class ThreadNotificationPublisher {
  private readonly lastStateByThread = new Map<string, Pick<Thread, "status" | "attention">>();
  /** ViscosityCode: the held error notification per thread (identity token). */
  private readonly heldErrors = new Map<string, object>();

  constructor(private readonly options: ThreadNotificationPublisherOptions) {}

  handleSupervisorEvent(event: SupervisorEvent): void {
    if (event.type !== "thread-state") return;
    const previous = this.lastStateByThread.get(event.threadId);
    this.lastStateByThread.set(event.threadId, {
      status: event.status,
      attention: event.attention,
    });
    if (previous === undefined) return;

    const category = classifyThreadNotification(
      previous.status,
      event.status,
      event.attention,
      previous.attention,
    );
    if (!category) return;

    const thread = this.options.getThread(event.threadId);
    if (!thread) return;
    const settings = this.options.getSettings();
    if (
      !shouldPublishThreadNotification({
        category,
        notificationsEnabled: settings.notificationsEnabled,
        notificationStatuses: settings.notificationStatuses,
        notifyL2Cli: settings.notifyL2Cli,
        ...(event.forceCloseActiveTurn ? { forceCloseActiveTurn: true } : {}),
        ...(thread.threadStatusSource ? { threadStatusSource: thread.threadStatusSource } : {}),
      })
    ) {
      return;
    }

    const notification: UserNotification = {
      threadId: event.threadId,
      category,
      projectName: this.options.getProjectName(thread.projectId),
      threadTitle: thread.title,
      status: threadAttentionStatus(event.status, event.attention),
    };
    // ViscosityCode: an account-pool failover may still move this thread on.
    const held =
      category === "error"
        ? this.options.holdErrorNotification?.(event.threadId, event.agentKind)
        : undefined;
    if (held) {
      this.publishWhenReleased(notification, held);
      return;
    }
    this.options.publish(notification);
  }

  /**
   * ViscosityCode: a host-composed notice that leaves the thread failed (an
   * account pool with every account out of usage), delivered to every client
   * as the thread's error notification on the existing wire shape: the notice
   * title takes the heading slot and its text the line under it. It replaces
   * a held error notification for the thread. Returns false when the owner's
   * notification settings turn error notifications off.
   */
  publishThreadNotice(notice: { threadId: string; title: string; body: string }): boolean {
    this.heldErrors.delete(notice.threadId);
    const settings = this.options.getSettings();
    if (
      !shouldPublishThreadNotification({
        category: "error",
        notificationsEnabled: settings.notificationsEnabled,
        notificationStatuses: settings.notificationStatuses,
        notifyL2Cli: settings.notifyL2Cli,
      })
    ) {
      return false;
    }
    this.options.publish({
      threadId: notice.threadId,
      category: "error",
      projectName: notice.title,
      threadTitle: notice.body,
      status: "error",
    });
    return true;
  }

  /** ViscosityCode: publish a held notification once released, unless a notice replaced it. */
  private publishWhenReleased(notification: UserNotification, held: Promise<boolean>): void {
    const token = {};
    this.heldErrors.set(notification.threadId, token);
    const release = (publish: boolean) => {
      if (this.heldErrors.get(notification.threadId) !== token) return;
      this.heldErrors.delete(notification.threadId);
      if (publish) this.options.publish(notification);
    };
    // A failed hold publishes; a throwing sink cannot surface from a timer.
    void held.then(release, () => release(true)).catch(() => undefined);
  }
}
