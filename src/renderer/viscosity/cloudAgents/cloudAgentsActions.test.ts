import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project, RemoteThreadCommand, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import type { EntityHost } from "@/renderer/state/entityHost";
import {
  checkCloudLaunchBranch,
  cloudLaunchRefusal,
  findFollowingThread,
  followCloudAgent,
  startNewCloudAgent,
} from "./cloudAgentsActions";
import type { CloudAgentSummary, FollowCloudAgentResult } from "./cloudAgentsContract";

const mocks = vi.hoisted(() => ({
  toastDanger: vi.fn<(message: string) => void>(),
  toastWarning: vi.fn<(message: string) => void>(),
  hostHandle: vi.fn<(key: string | undefined) => unknown>(),
  follow: vi.fn<(payload: unknown) => Promise<FollowCloudAgentResult>>(),
  bridgePresent: true,
  openThread: vi.fn<(threadId: string, options?: unknown) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
  getGitStatus: vi.fn<(payload: unknown) => Promise<unknown>>(),
  currentProjectId: undefined as string | undefined,
  statuses: [] as AgentStatus[],
}));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast: {
    danger: mocks.toastDanger,
    warning: mocks.toastWarning,
    success: vi.fn<(message: string) => void>(),
  },
}));
vi.mock("@/renderer/state/entityHost", async (original) => ({
  ...(await original<typeof import("@/renderer/state/entityHost")>()),
  hostHandle: mocks.hostHandle,
}));
vi.mock("./cloudAgentsContract", () => ({
  cloudAgentsBridge: () =>
    mocks.bridgePresent
      ? {
          listCloudAgents: vi.fn<() => Promise<never>>(),
          getCloudAgent: vi.fn<() => Promise<never>>(),
          followCloudAgent: mocks.follow,
        }
      : undefined,
}));
vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: mocks.openThread,
  openNewThread: mocks.openNewThread,
}));
vi.mock("@/renderer/actions/currentProject", () => ({
  getCurrentProjectId: () => mocks.currentProjectId,
}));
vi.mock("@/renderer/hooks/useHostAgentStatuses", () => ({
  readHostAgentStatusPools: () => ({ windows: mocks.statuses, wsl: [] }),
}));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ getGitStatus: mocks.getGitStatus }),
}));

const home = {
  id: HOME_PROJECT_ID,
  name: "Home",
  location: { kind: "posix", path: "/Users/me" },
} as Project;
const repoProject = {
  id: "repo",
  name: "repo",
  location: { kind: "posix", path: "/work/repo" },
} as Project;

const item: CloudAgentSummary = {
  agentKind: "sample:cloud",
  id: "bc-1",
  providerSessionId: "sdk:bc-1",
  name: "Fix the flaky test",
  status: "running",
  updatedAt: "2026-11-20T10:00:00.000Z",
  repos: [{ url: "github.com/acme/api" }],
};

const status = {
  kind: "sample:cloud",
  capabilities: { models: [{ id: "model-a", label: "Model A" }] },
} as unknown as AgentStatus;

function fakeHost() {
  const sendThreadCommand = vi.fn<(command: RemoteThreadCommand) => Promise<void>>(
    async () => undefined,
  );
  const refreshCatalog = vi.fn<() => void>();
  const host = {
    kind: "managed",
    connectionKey: undefined,
    hostId: "",
    sendThreadCommand,
    hostProjectId: (id: string) => id,
    projectThreadRow: (threadId: string) => ({ threadId }),
    refreshCatalog,
  } as unknown as EntityHost;
  mocks.hostHandle.mockImplementation((key) => (key === undefined ? host : undefined));
  return { sendThreadCommand, refreshCatalog };
}

/** The host records the follow's resume reference before its reply, as it does in the app. */
function followRecordsSessionRef(result: FollowCloudAgentResult) {
  mocks.follow.mockImplementation(async (payload) => {
    const { threadId: id } = payload as { threadId: string };
    useAppStore.setState({
      threads: [{ id, sessionRef: { providerSessionId: "sdk:bc-1" } } as Thread],
    });
    return result;
  });
}

beforeEach(() => {
  useAppStore.setState({ threads: [], projects: [home, repoProject] });
  mocks.statuses = [status];
  mocks.bridgePresent = true;
  mocks.currentProjectId = undefined;
});

afterEach(() => {
  useAppStore.setState({ threads: [], projects: [], view: { kind: "home" } });
  vi.clearAllMocks();
});

describe("followCloudAgent", () => {
  it("creates a Home GUI thread, then has the host follow the agent and opens it live", async () => {
    const host = fakeHost();
    followRecordsSessionRef({ messageCount: 4, running: true });

    const threadId = await followCloudAgent(item);

    expect(host.sendThreadCommand).toHaveBeenCalledTimes(1);
    const create = host.sendThreadCommand.mock.calls[0]![0];
    expect(create).toMatchObject({
      kind: "create",
      threadId,
      projectId: HOME_PROJECT_ID,
      agentKind: "sample:cloud",
      title: "Fix the flaky test",
      config: { model: "model-a" },
      presentationMode: "gui",
    });
    expect(mocks.follow).toHaveBeenCalledWith({
      threadId,
      agentKind: "sample:cloud",
      agentId: "bc-1",
    });
    expect(host.refreshCatalog).toHaveBeenCalled();
    expect(mocks.openThread).toHaveBeenCalledWith(threadId);
  });

  it("opens a running agent only once the host has recorded its resume reference", async () => {
    fakeHost();
    mocks.follow.mockResolvedValue({ messageCount: 4, running: true });
    const followed = followCloudAgent(item);
    await vi.waitFor(() => expect(mocks.follow).toHaveBeenCalled());
    const { threadId } = mocks.follow.mock.calls[0]![0] as { threadId: string };
    await Promise.resolve();
    expect(mocks.openThread).not.toHaveBeenCalled();

    useAppStore.setState({
      threads: [{ id: threadId, sessionRef: { providerSessionId: "sdk:bc-1" } } as Thread],
    });

    expect(await followed).toBe(threadId);
    expect(mocks.openThread).toHaveBeenCalledWith(threadId);
  });

  it("says when only the newest messages were copied", async () => {
    fakeHost();
    followRecordsSessionRef({ messageCount: 1000, running: false, truncated: true });
    await followCloudAgent(item);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
  });

  it("finishes a finished agent's follow only once its resume reference is in the store", async () => {
    fakeHost();
    mocks.follow.mockResolvedValue({ messageCount: 2, running: false });
    let settled = false;
    const followed = followCloudAgent(item).finally(() => (settled = true));
    await vi.waitFor(() => expect(mocks.follow).toHaveBeenCalled());
    const { threadId } = mocks.follow.mock.calls[0]![0] as { threadId: string };
    await new Promise((done) => setTimeout(done, 0));
    // Without the reference the list cannot see the follow, so a second press would add a row.
    expect(settled).toBe(false);
    expect(mocks.openThread).not.toHaveBeenCalled();

    useAppStore.setState({
      threads: [{ id: threadId, sessionRef: { providerSessionId: "sdk:bc-1" } } as Thread],
    });

    expect(await followed).toBe(threadId);
    expect(mocks.openThread).toHaveBeenCalledWith(threadId, { reopenRuntime: false });
  });

  it("deletes the new row when the host refuses the follow", async () => {
    const host = fakeHost();
    mocks.follow.mockRejectedValue(new Error("key rejected"));

    expect(await followCloudAgent(item)).toBeUndefined();

    const created = host.sendThreadCommand.mock.calls[0]![0] as { threadId: string };
    expect(host.sendThreadCommand).toHaveBeenLastCalledWith({
      kind: "delete",
      threadId: created.threadId,
    });
    expect(mocks.toastDanger).toHaveBeenCalled();
    expect(mocks.openThread).not.toHaveBeenCalled();
  });

  it("does not follow or delete when the row could not be created", async () => {
    const host = fakeHost();
    host.sendThreadCommand.mockRejectedValueOnce(new Error("offline"));

    expect(await followCloudAgent(item)).toBeUndefined();

    expect(host.sendThreadCommand).toHaveBeenCalledTimes(1);
    expect(mocks.follow).not.toHaveBeenCalled();
    expect(mocks.toastDanger).toHaveBeenCalled();
  });

  it("opens the thread that already follows the agent instead of adding another", async () => {
    const host = fakeHost();
    useAppStore.setState({
      threads: [
        {
          id: "t-1",
          agentKind: "sample:cloud",
          sessionRef: { providerSessionId: "sdk:bc-1" },
        } as unknown as Thread,
      ],
    });
    expect(await followCloudAgent(item)).toBe("t-1");
    expect(host.sendThreadCommand).not.toHaveBeenCalled();
    expect(mocks.openThread).toHaveBeenCalledWith("t-1");
  });

  it("joins a follow already under way", async () => {
    const host = fakeHost();
    let resolve!: (value: FollowCloudAgentResult) => void;
    mocks.follow.mockReturnValue(new Promise((done) => (resolve = done)));
    const first = followCloudAgent(item);
    const second = followCloudAgent(item);
    await vi.waitFor(() => expect(mocks.follow).toHaveBeenCalledTimes(1));
    const { threadId } = mocks.follow.mock.calls[0]![0] as { threadId: string };
    useAppStore.setState({
      threads: [{ id: threadId, sessionRef: { providerSessionId: "sdk:bc-1" } } as Thread],
    });
    resolve({ messageCount: 1, running: false });
    expect(await second).toBe(await first);
    expect(host.sendThreadCommand).toHaveBeenCalledTimes(1);
  });

  it("refuses without a cloud agents host", async () => {
    fakeHost();
    mocks.bridgePresent = false;
    expect(await followCloudAgent(item)).toBeUndefined();
    expect(mocks.toastDanger).toHaveBeenCalled();
  });
});

describe("findFollowingThread", () => {
  it("matches the exact resume reference on this host only", () => {
    const thread = (id: string, providerSessionId: string, extra: object = {}) =>
      ({ id, agentKind: "sample:cloud", sessionRef: { providerSessionId }, ...extra }) as Thread;
    const threads = [
      thread("prefix", "sdk:bc-10"),
      thread("paired", "sdk:bc-1", { remoteServerId: "pc" }),
      thread("exact", "sdk:bc-1"),
    ];
    expect(findFollowingThread(item, threads)?.id).toBe("exact");
    expect(findFollowingThread({ ...item, agentKind: "other" }, threads)).toBeUndefined();
  });
});

describe("cloud launch branch check", () => {
  const git = (patch: object) => ({
    isRepo: true,
    branch: "feature",
    tracking: "origin/feature",
    ahead: 0,
    ...patch,
  });

  it("refuses a branch with no upstream or with unpushed commits", async () => {
    mocks.getGitStatus.mockResolvedValueOnce(git({ tracking: "" }));
    const noUpstream = await checkCloudLaunchBranch(repoProject);
    expect(noUpstream).toEqual({ ok: false, reason: "no-upstream", branch: "feature" });
    expect(cloudLaunchRefusal(noUpstream)).toBe(
      "Push feature to its remote first. Cloud agents start from the pushed branch.",
    );

    mocks.getGitStatus.mockResolvedValueOnce(git({ ahead: 2 }));
    const unpushed = await checkCloudLaunchBranch(repoProject);
    expect(cloudLaunchRefusal(unpushed)).toBe(
      "feature has 2 commits that are not pushed. Push them first: cloud agents start from the pushed branch.",
    );
  });

  it("allows a pushed branch, a folder outside git, and Home", async () => {
    mocks.getGitStatus.mockResolvedValueOnce(git({}));
    expect(await checkCloudLaunchBranch(repoProject)).toEqual({ ok: true });
    mocks.getGitStatus.mockResolvedValueOnce(git({ isRepo: false, tracking: "" }));
    expect(await checkCloudLaunchBranch(repoProject)).toEqual({ ok: true });
    expect(await checkCloudLaunchBranch(home)).toEqual({ ok: true });
    expect(mocks.getGitStatus).toHaveBeenCalledTimes(2);
  });
});

describe("startNewCloudAgent", () => {
  it("refuses an unpushed branch and opens no composer", async () => {
    mocks.currentProjectId = "repo";
    mocks.getGitStatus.mockResolvedValue({ isRepo: true, branch: "wip", tracking: "", ahead: 0 });
    await startNewCloudAgent("sample:cloud");
    expect(mocks.toastDanger).toHaveBeenCalledWith(
      "Push wip to its remote first. Cloud agents start from the pushed branch.",
    );
    expect(mocks.openNewThread).not.toHaveBeenCalled();
  });

  it("opens the composer on the current project with the cloud profile chosen", async () => {
    mocks.currentProjectId = "repo";
    mocks.getGitStatus.mockResolvedValue({
      isRepo: true,
      branch: "main",
      tracking: "origin/main",
      ahead: 0,
    });
    await startNewCloudAgent("sample:cloud");
    expect(mocks.openNewThread).toHaveBeenCalledWith("repo");
    const project = useAppStore.getState().projects.find((entry) => entry.id === "repo");
    expect(project?.lastDraftConfig).toEqual({ agentKind: "sample:cloud", model: "model-a" });
  });
});
