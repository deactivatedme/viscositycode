// ViscosityCode: account pools — an error notification is held while a failover
// is pending, dropped when the thread moved on, and replaced by a pool notice.
import { describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type { UserNotification } from "@/shared/threadNotification";
import { ThreadNotificationPublisher } from "./ThreadNotificationPublisher";

function thread(): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Ship it",
    agentKind: "codex",
    config: { model: "gpt-5" },
    status: "working",
    attention: "working",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function state(status: "working" | "error" | "finished", agentKind?: string): SupervisorEvent {
  return {
    type: "thread-state",
    threadId: "thread-1",
    status,
    attention: status === "error" ? "error" : status === "working" ? "working" : "none",
    canResumeWithConfig: false,
    ...(agentKind ? { agentKind } : {}),
  };
}

function makePublisher(
  hold: ((threadId: string, agentKind?: string) => Promise<boolean> | undefined) | undefined,
  errorEnabled = true,
) {
  const publish = vi.fn<(notification: UserNotification) => void>();
  const publisher = new ThreadNotificationPublisher({
    getThread: () => thread(),
    getProjectName: () => "Repo",
    getSettings: () => ({
      notificationsEnabled: true,
      notificationStatuses: { done: true, needsAttention: true, error: errorEnabled },
      notifyL2Cli: true,
    }),
    publish,
    ...(hold ? { holdErrorNotification: hold } : {}),
  });
  publisher.handleSupervisorEvent(state("working"));
  return { publisher, publish };
}

/** Lets every settled hold's callbacks run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const ERROR_NOTIFICATION: UserNotification = {
  threadId: "thread-1",
  category: "error",
  projectName: "Repo",
  threadTitle: "Ship it",
  status: "error",
};

describe("ThreadNotificationPublisher account-pool hold", () => {
  it("publishes at once when nothing holds the error", () => {
    const hold = vi.fn<() => undefined>(() => undefined);
    const { publisher, publish } = makePublisher(hold);
    publisher.handleSupervisorEvent(state("error", "codex"));
    expect(hold).toHaveBeenCalledWith("thread-1", "codex");
    expect(publish).toHaveBeenCalledExactlyOnceWith(ERROR_NOTIFICATION);
  });

  it("drops a held error when the failover moved the thread on", async () => {
    const release = Promise.withResolvers<boolean>();
    const { publisher, publish } = makePublisher(() => release.promise);
    publisher.handleSupervisorEvent(state("error"));
    expect(publish).not.toHaveBeenCalled();
    release.resolve(false);
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes a held error when the thread stays failed", async () => {
    const release = Promise.withResolvers<boolean>();
    const { publisher, publish } = makePublisher(() => release.promise);
    publisher.handleSupervisorEvent(state("error"));
    release.resolve(true);
    await vi.waitFor(() => expect(publish).toHaveBeenCalledExactlyOnceWith(ERROR_NOTIFICATION));
  });

  it("publishes a held error whose hold failed", async () => {
    const { publisher, publish } = makePublisher(() => Promise.reject(new Error("boom")));
    publisher.handleSupervisorEvent(state("error"));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledExactlyOnceWith(ERROR_NOTIFICATION));
  });

  it("never holds other categories", () => {
    const hold = vi.fn<() => Promise<boolean>>(async () => false);
    const { publisher, publish } = makePublisher(hold);
    publisher.handleSupervisorEvent(state("finished"));
    expect(hold).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("replaces a held error with a pool notice on the existing wire shape", async () => {
    const release = Promise.withResolvers<boolean>();
    const { publisher, publish } = makePublisher(() => release.promise);
    publisher.handleSupervisorEvent(state("error"));
    expect(
      publisher.publishThreadNotice({
        threadId: "thread-1",
        title: "Codex accounts are out of usage",
        body: "All Codex accounts in your pool are out of usage.",
      }),
    ).toBe(true);
    release.resolve(true);
    await flush();
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      category: "error",
      projectName: "Codex accounts are out of usage",
      threadTitle: "All Codex accounts in your pool are out of usage.",
      status: "error",
    });
  });

  it("honours a disabled error notification setting for pool notices", () => {
    const { publisher, publish } = makePublisher(undefined, false);
    expect(
      publisher.publishThreadNotice({ threadId: "thread-1", title: "Out", body: "All out." }),
    ).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});
