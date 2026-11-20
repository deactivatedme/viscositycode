import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { RoundtableSession } from "@/renderer/viscosity/roundtable/types";
import { session } from "@/renderer/viscosity/roundtable/ui/roundtable.testFixtures";
import { useRoundtableViewStore } from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import { useOpenTabsStore } from "./openTabsStore";
import { activateThreadTab } from "./tabActions";
import { ViscosityCenterFrame } from "./ViscosityCenterFrame";

const threadActions = vi.hoisted(() => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
}));
const api = vi.hoisted(() => ({ sessions: new Map<string, RoundtableSession>() }));

vi.mock("@/renderer/actions/threadActions", () => threadActions);
vi.mock("@/renderer/viscosity/roundtable/api", () => ({
  useRoundtableList: () => [],
  useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
  useLiveTurnText: () => "",
  useReadyAgentBrains: () => [],
}));

let releaseShell: (() => void) | undefined;

function renderCenter() {
  return render(
    <ViscosityCenterFrame>
      <div data-testid="content" />
    </ViscosityCenterFrame>,
  );
}

beforeEach(() => {
  threadActions.openThread.mockReset();
  api.sessions.clear();
  api.sessions.set("rt1", session({ status: "running" }));
  useOpenTabsStore.setState({ ids: [] });
  useFileEditorStore.setState({ rootContext: null, overlayMode: null, tabs: [] });
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  useAppStore.setState({
    threads: [
      {
        id: "a",
        projectId: "p1",
        title: "Thread a",
        agentKind: "test-agent",
        status: "idle",
        archived: false,
        done: false,
      } as Thread,
    ],
    projects: [{ id: "p1", name: "Project", location: { kind: "local" } } as unknown as Project],
    view: { kind: "thread", panes: ["a"] },
    focusedPaneId: "a",
    pendingActiveThreadId: null,
  });
  document.documentElement.dataset.windowKind = "main";
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
  delete document.documentElement.dataset.windowKind;
});

describe("Roundtable tab", () => {
  it("is absent until a Roundtable is opened", () => {
    renderCenter();
    expect(screen.queryByRole("tab", { name: /Roundtable/ })).toBeNull();
    expect(document.querySelector("[data-vc-roundtable-panel]")).toBeNull();
  });

  it("shows the open session over the threads and takes the selection", async () => {
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    renderCenter();
    const tab = screen.getByRole("tab", { name: "Roundtable: Fix the login bug" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.parentElement?.querySelector('.vc-tab__dot[data-tone="working"]')).not.toBeNull();
    expect(document.querySelector("[data-vc-roundtable-panel]")).not.toBeNull();
    // The panel's view loads lazily on first use.
    expect(
      await screen.findByRole("heading", { name: "Fix the login bug" }, { timeout: 10_000 }),
    ).toBeTruthy();
  });

  it("shows an idle team chat's dot as inactive, not working", () => {
    api.sessions.set("rt1", session({ status: "running", pattern: "open", maxRounds: 0 }));
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: false });
    renderCenter();
    const tab = screen.getByRole("tab", { name: "Roundtable: Fix the login bug" });
    expect(tab.parentElement?.querySelector('.vc-tab__dot[data-tone="inactive"]')).not.toBeNull();
  });

  it("steps aside for a thread opened from the sidebar and comes back from its own tab", async () => {
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    renderCenter();
    await act(async () => activateThreadTab("a"));
    expect(threadActions.openThread).toHaveBeenCalledWith("a");
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: false });
    expect(document.querySelector("[data-vc-roundtable-panel]")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Roundtable: Fix the login bug" }));
    expect(useRoundtableViewStore.getState().shown).toBe(true);
  });

  it("closes the panel and the tab, leaving the threads", () => {
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "Close Roundtable Fix the login bug" }));
    expect(screen.queryByRole("tab", { name: /Roundtable/ })).toBeNull();
    expect(document.querySelector("[data-vc-roundtable-panel]")).toBeNull();
    expect(useAppStore.getState().view).toMatchObject({ kind: "thread", panes: ["a"] });
  });

  it("hides the panel when the user opens a thread elsewhere", async () => {
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    renderCenter();
    await act(async () => {
      useAppStore.setState({ pendingActiveThreadId: "a" });
    });
    expect(document.querySelector("[data-vc-roundtable-panel]")).toBeNull();
    expect(screen.getByRole("tab", { name: /Roundtable/ })).toBeTruthy();
  });
});
