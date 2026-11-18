// ViscosityCode: where MainView mounts the status bar frame. It wraps the main
// layout inside the browser client's connection gate, so the pairing page never
// gets a status bar (nor the shell flag).
import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PoracodeBridge } from "@/shared/ipc";
import { installBrowserClientRuntime, resetClientRuntimeForTest } from "@/renderer/clientRuntime";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { MainView } from "@/renderer/views/MainView/MainView";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";

vi.mock("@/renderer/adaptiveLayout", () => ({ useCompactLayout: () => false }));
vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ view: { kind: "home" }, projects: [], threads: [], openHome: vi.fn<() => void>() }),
}));
vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: object) => unknown) =>
    selector({ homeScopeEnabled: false, sharedSettingsHydrated: false }),
}));
vi.mock("@/renderer/state/welcomeGateStore", () => ({
  useWelcomeGateStore: (selector: (state: { backgroundWorkReleased: boolean }) => unknown) =>
    selector({ backgroundWorkReleased: false }),
}));
vi.mock("@/renderer/actions/projectActions", () => ({
  ensureHomeScopeProject: vi.fn<() => void>(),
}));
vi.mock("@/renderer/hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: vi.fn<() => void>(),
}));
vi.mock("@/renderer/hooks/useGitRefresh", () => ({ useGitRefresh: vi.fn<() => void>() }));
vi.mock("@/renderer/hooks/useRemoteServerConnection", () => ({
  useRemoteServerConnection: () => ({ checked: true }),
}));
vi.mock("@/renderer/hooks/useRightPanelThreadLock", () => ({
  useRightPanelThreadLock: vi.fn<() => void>(),
}));
vi.mock("@/renderer/hooks/useThreadLifecycle", () => ({ useThreadLifecycle: vi.fn<() => void>() }));
vi.mock("@/renderer/hooks/useDndHandlers", () => ({ useDndHandlers: () => ({}) }));
vi.mock(
  "@/renderer/views/MainView/parts/RightPanel/parts/BrowserPanel/hooks/useBrowserSync",
  () => ({ useBrowserSync: vi.fn<() => void>() }),
);
vi.mock("@/renderer/views/MainView/parts/mobilePageHistory", () => ({
  useMobilePageHistory: vi.fn<() => void>(),
}));
vi.mock("@/renderer/dnd", () => ({
  AppDndProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CompactDndProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/renderer/deferredFeatures", () => ({ DeferredCommandPalette: () => null }));
vi.mock("@/renderer/views/MainView/parts/MainPageLayout", () => ({
  MainPageLayout: () => <div>Connected page</div>,
  StalePanelCleanup: () => null,
}));
vi.mock("@/renderer/views/MainView/parts/BrowserConnectionPage/BrowserConnectionPage", () => ({
  BrowserConnectionPage: () => <div>Pairing page</div>,
}));
vi.mock("@/renderer/views/MainView/parts/MobileTopLevelPage", () => ({
  MobileTopLevelPage: () => null,
}));
vi.mock("@/renderer/views/MainView/parts/AppOverlays", () => ({ AppOverlays: () => null }));
vi.mock("@/renderer/views/MainView/parts/WorktreeDeleteDialogs", () => ({
  WorktreeDeleteDialogs: () => null,
}));
vi.mock("@/renderer/views/MainView/parts/PullFromSourceDialog", () => ({
  PullFromSourceDialog: () => null,
}));
vi.mock("@/renderer/components/thread/ChatPane/parts/items/ActiveSubAgentTile", () => ({
  ThreadLiveWorkflowTracker: () => null,
}));
vi.mock("@/renderer/diagnostics/runtimeContext", () => ({
  RendererRuntimeDiagnosticContextSync: () => null,
}));
// The built-in items read app state this test does not set up.
vi.mock("./builtinStatusBarItems", () => ({ registerBuiltinStatusBarItems: () => {} }));
// The fx layer subscribes to the real app store, which this test replaces.
vi.mock("@/renderer/fx/FxRoot", () => ({ FxRoot: () => null }));

beforeEach(() => {
  document.documentElement.dataset.windowKind = "main";
  resetClientRuntimeForTest();
  window.poracode = {} as PoracodeBridge;
  installBrowserClientRuntime(window.poracode);
  useRemoteServersStore.setState({ servers: [], runtime: {} });
  usePanelStore.setState({ mobileUtilityPage: null });
});

afterEach(() => {
  resetClientRuntimeForTest();
  Reflect.deleteProperty(window, "poracode");
  delete document.documentElement.dataset.windowKind;
});

it("keeps the status bar and the shell flag off the browser client's pairing page", () => {
  render(<MainView storeHydrated={false} runtimeSnapshotsReady={false} />);
  expect(screen.getByText("Pairing page")).toBeInTheDocument();
  expect(document.querySelector("[data-vc-statusbar]")).toBeNull();
  expect(document.documentElement).not.toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

it("puts the status bar below the main layout once a host is paired", () => {
  useRemoteServersStore.setState({
    servers: [
      {
        desktopId: "desktop-1",
        label: "Desktop",
        endpoint: "http://desktop.test",
        accessToken: "test-token",
      },
    ],
    runtime: {},
  } as never);
  render(<MainView storeHydrated={false} runtimeSnapshotsReady={false} />);
  const page = screen.getByText("Connected page");
  const bar = document.querySelector("[data-vc-statusbar]");
  expect(bar).not.toBeNull();
  expect(page.compareDocumentPosition(bar!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.documentElement).toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});
