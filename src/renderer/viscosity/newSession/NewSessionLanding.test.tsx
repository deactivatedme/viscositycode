// ViscosityCode: the shell's New session landing (replaces HomeView).
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";

const openNewThread = vi.hoisted(() => vi.fn<(projectId?: string) => void>());
vi.mock("@/renderer/actions/threadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/actions/threadActions")>()),
  openNewThread,
}));

import { NewSessionLanding } from "./NewSessionLanding";

const project = (id: string): Project => ({
  id,
  name: id,
  location: { kind: "posix", path: `/repo/${id}` },
  createdAt: "2026-01-01T00:00:00.000Z",
});
const home: Project = { ...project(HOME_PROJECT_ID), name: "Home" };

const thread = (id: string, projectId: string, updatedAt: string, archived = false): Thread => ({
  id,
  projectId,
  title: id,
  agentKind: "codex",
  config: { model: "gpt-5.4" },
  status: "idle",
  attention: "none",
  canResumeWithConfig: false,
  archived,
  done: false,
  starred: false,
  createdAt: updatedAt,
  updatedAt,
});

const openDraft = vi.fn<(projectId: string) => void>();

describe("NewSessionLanding", () => {
  beforeEach(() => {
    openDraft.mockReset();
    openNewThread.mockReset();
    useAppStore.setState({ projects: [], threads: [], view: { kind: "home" }, openDraft });
    useSharedSettings.setState({
      sharedSettingsHydrated: true,
      homeScopeEnabled: true,
      workspaces: [],
    });
    useWorkspaceStore.setState({ activeWorkspaceId: null, lastProjectIdByWorkspace: {} });
  });

  it("opens a draft in the project of the most recently updated thread", () => {
    useAppStore.setState({
      projects: [project("a"), project("b"), project("c")],
      threads: [
        thread("t1", "a", "2026-02-01T00:00:00.000Z"),
        thread("t2", "b", "2026-03-01T00:00:00.000Z"),
        // Archived threads do not count.
        thread("t3", "c", "2026-04-01T00:00:00.000Z", true),
      ],
    });

    render(<NewSessionLanding redirect />);

    expect(openDraft).toHaveBeenCalledWith("b");
  });

  it("skips a newer Home thread when Home scope is off", () => {
    useSharedSettings.setState({ homeScopeEnabled: false });
    useAppStore.setState({
      projects: [home, project("a")],
      threads: [
        thread("t1", "a", "2026-02-01T00:00:00.000Z"),
        thread("t2", HOME_PROJECT_ID, "2026-03-01T00:00:00.000Z"),
      ],
    });

    render(<NewSessionLanding redirect />);

    expect(openDraft).toHaveBeenCalledWith("a");
  });

  it("opens a draft in Home when it is the only project", () => {
    useAppStore.setState({ projects: [home] });

    render(<NewSessionLanding redirect />);

    expect(openDraft).toHaveBeenCalledWith(HOME_PROJECT_ID);
  });

  it("offers Add folder and does not redirect with no project at all", () => {
    useSharedSettings.setState({ homeScopeEnabled: false });

    render(<NewSessionLanding redirect />);

    expect(openDraft).not.toHaveBeenCalled();
    expect(screen.getByText("Add a folder to start")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add folder" })).toBeInTheDocument();
  });

  it("shows a New session button instead of redirecting when redirect is off", () => {
    useAppStore.setState({ projects: [project("a")] });

    render(<NewSessionLanding redirect={false} />);

    expect(openDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(openNewThread).toHaveBeenCalledOnce();
  });

  it("waits for shared settings before redirecting", () => {
    useSharedSettings.setState({ sharedSettingsHydrated: false });
    useAppStore.setState({ projects: [project("a")] });

    render(<NewSessionLanding redirect />);

    expect(openDraft).not.toHaveBeenCalled();
    expect(screen.queryByText("Add a folder to start")).not.toBeInTheDocument();
  });
});
