// ViscosityCode: the New session centre's device menu and Start from scratch.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import { HOME_PROJECT_ID, HOME_PROJECT_NAME } from "@/shared/homeScope";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useProjectGroupStore } from "@/renderer/state/projectGroups/projectGroupStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorkspaceStore } from "@/renderer/state/workspaceStore";

const mocks = vi.hoisted(() => ({
  localBackend: false,
  commitCreateProject: vi.fn<(params: unknown) => Promise<void>>(),
  commitRemoteCreateProject: vi.fn<(params: unknown) => Promise<void>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    platform: "darwin",
    listWslDistros: () => Promise.resolve([]),
    getHomeScopeLocation: () => Promise.resolve({ kind: "posix", path: "/Users/me" }),
  }),
  isRemoteSession: () => false,
  isWindows: () => false,
}));
vi.mock("@/renderer/clientRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/clientRuntime")>()),
  hasClientCapability: () => mocks.localBackend,
}));
vi.mock("@/renderer/components/common/ResponsiveMenuSurface", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/components/common/ResponsiveMenuSurface")>()),
  useResponsiveMenu: () => ({ mobile: false }),
}));
vi.mock("@/renderer/actions/createProjectActions", () => ({
  addExistingProject: () => Promise.resolve(),
  commitCreateProject: mocks.commitCreateProject,
  commitRemoteCreateProject: mocks.commitRemoteCreateProject,
  resolveMachineHomeLocation: (connectionKey: string) =>
    Promise.resolve({
      kind: "posix",
      path: `/Users/${connectionKey}`,
      remoteServerId: connectionKey,
    }),
  machinePathLocation: (connectionKey: string, path: string) => ({
    kind: "posix",
    path,
    remoteServerId: connectionKey,
  }),
}));

import { CreateProjectModal } from "@/renderer/views/MainView/parts/CreateProject/CreateProjectModal";
import { NewSessionCenter } from "./NewSessionCenter";

function local(id: string, name: string): Project {
  return {
    id,
    name,
    location: { kind: "posix", path: `/code/${id}` },
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

function mirror(server: string, remoteId: string, name: string): Project {
  return {
    ...local(`remote:${server}:project:${remoteId}`, name),
    remoteServerId: server,
    remoteId,
    location: { kind: "posix", path: `/code/${remoteId}`, remoteServerId: server },
  };
}

// Production persists the synthetic Home row with `disabled: true`.
const localHome: Project = { ...local(HOME_PROJECT_ID, HOME_PROJECT_NAME), disabled: true };
const macHome: Project = { ...mirror("mac", HOME_PROJECT_ID, HOME_PROJECT_NAME), disabled: true };
const alpha = local("alpha", "Alpha");
const miniBeta = mirror("mini", "beta", "Beta");

function pair(scopes: readonly string[] = ["projects:manage"]) {
  useRemoteServersStore.setState({
    servers: [
      { desktopId: "mac", label: "Poracode on MacBook", scopes },
      { desktopId: "mini", label: "Poracode on Mac mini", scopes },
    ],
    runtime: {
      mac: { status: "online", projects: [], threads: [] },
      mini: { status: "online", projects: [], threads: [] },
    },
  } as never);
}

/** The draft view as AppContent mounts it, with the app's create dialog beside it. */
function DraftCentre() {
  const project = useAppStore((state) =>
    state.projects.find((row) => state.view.kind === "draft" && row.id === state.view.projectId),
  );
  return project ? (
    <>
      <NewSessionCenter project={project} />
      <CreateProjectModal />
    </>
  ) : null;
}

function openDraft(projects: Project[], projectId: string) {
  useAppStore.setState({ projects, view: { kind: "draft", projectId } });
  render(<DraftCentre />);
}

describe("NewSessionCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localBackend = false;
    mocks.commitCreateProject.mockResolvedValue(undefined);
    mocks.commitRemoteCreateProject.mockResolvedValue(undefined);
    localStorage.clear();
    pair();
    useProjectGroupStore.setState({ manualGroups: {}, lastUsedAt: {} });
    useGitStore.setState({ statuses: {} });
    useSharedSettings.setState({ homeScopeEnabled: true, workspaces: [], lastUsedProjectDirs: {} });
    useWorkspaceStore.setState({ activeWorkspaceId: null, lastProjectIdByWorkspace: {} });
    useAppStore.setState({ draftContents: {}, draftContentDiscardRequests: {} });
    usePanelStore.setState({ createProjectModalOpen: false, createProjectModalRuntimeKey: null });
  });

  it("opens the device menu with a single device, selected, and flips its chevron", async () => {
    openDraft([macHome], macHome.id);

    const trigger = screen.getByRole("button", { name: "Machine: MacBook" });
    const chevron = trigger.querySelector(".lucide-chevron-down");
    // The flip keys off the trigger's own expanded state.
    expect(trigger).toHaveClass("group");
    expect(chevron).toHaveClass("group-aria-expanded:rotate-180");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    const items = within(await screen.findByRole("menu")).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["MacBook"]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("lists every device and moves the draft to the picked one", async () => {
    mocks.localBackend = true;
    // Alpha lives on this computer only; the other devices open their own project.
    openDraft([localHome, macHome, alpha, miniBeta], alpha.id);

    fireEvent.click(screen.getByRole("button", { name: "Machine: Local" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Local", "MacBook", "Mac mini"]);

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Mac mini" }));
    await waitFor(() =>
      expect(useAppStore.getState().view).toEqual({ kind: "draft", projectId: miniBeta.id }),
    );
    expect(await screen.findByRole("button", { name: "Machine: Mac mini" })).toBeInTheDocument();

    // Start from scratch follows the device the draft now targets.
    fireEvent.click(screen.getByRole("button", { name: "Start from scratch" }));
    expect(usePanelStore.getState().createProjectModalRuntimeKey).toBe("machine:mini");
  });

  it("sends a device back to the project used there most recently", async () => {
    mocks.localBackend = true;
    useProjectGroupStore.setState({ lastUsedAt: { [alpha.id]: 5 } });
    // Beta lives on the Mac mini only, so this computer opens its own project.
    openDraft([localHome, alpha, miniBeta], miniBeta.id);

    fireEvent.click(screen.getByRole("button", { name: "Machine: Mac mini" }));
    const menu = await screen.findByRole("menu");
    // Same device order as from any other project: this computer first.
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Local", "Mac mini"]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Local" }));
    await waitFor(() =>
      expect(useAppStore.getState().view).toEqual({ kind: "draft", projectId: alpha.id }),
    );
  });

  it("creates a project from scratch on the draft's device through the routed command", async () => {
    // The Tauri window: a browser client whose only device is its paired host.
    openDraft([macHome], macHome.id);

    fireEvent.click(screen.getByRole("button", { name: "Start from scratch" }));
    const runtime = await screen.findByRole("button", { name: "Runtime" });
    expect(runtime).toHaveTextContent("MacBook");
    const location = screen.getByLabelText("Browse for parent folder");
    await waitFor(() => expect(location).toHaveTextContent("/Users/mac"));

    // This client has no disk of its own, so only paired machines are offered.
    fireEvent.click(runtime);
    const options = within(await screen.findByRole("menu")).getAllByRole("menuitemradio");
    expect(options.map((item) => item.textContent)).toEqual(["MacBook", "Mac mini"]);
    fireEvent.keyDown(options[0]!, { key: "Escape" });

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "my-app" } });
    const create = screen.getByRole("button", { name: "Create project" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() =>
      expect(mocks.commitRemoteCreateProject).toHaveBeenCalledWith({
        connectionKey: "mac",
        parentDir: "/Users/mac",
        name: "my-app",
      }),
    );
    // Never the main-local directory procedure, which a remote session lacks.
    expect(mocks.commitCreateProject).not.toHaveBeenCalled();
  });

  it("creates on this computer for a local draft", async () => {
    mocks.localBackend = true;
    openDraft([localHome, alpha], alpha.id);

    fireEvent.click(screen.getByRole("button", { name: "Start from scratch" }));
    const location = await screen.findByLabelText("Browse for parent folder");
    await waitFor(() => expect(location).toHaveTextContent("/Users/me"));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "my-app" } });
    const create = screen.getByRole("button", { name: "Create project" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() =>
      expect(mocks.commitCreateProject).toHaveBeenCalledWith({
        mode: "scratch",
        choice: { kind: "native" },
        dir: "/Users/me",
        name: "my-app",
      }),
    );
    expect(mocks.commitRemoteCreateProject).not.toHaveBeenCalled();
  });

  it("hides Start from scratch when the device cannot create projects", () => {
    pair(["session:read"]);
    openDraft([macHome], macHome.id);

    expect(screen.getByRole("button", { name: "Add folder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start from scratch" })).not.toBeInTheDocument();
  });
});
