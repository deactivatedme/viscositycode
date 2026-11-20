// ViscosityCode: fork-only. Settings sections the host's own Tauri window shows.
import { cleanup, fireEvent, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import { IPC_PROCEDURE_MAP_VERSION, type PoracodeBridge } from "@/shared/ipc";
import { hostServiceCapabilities } from "@/shared/hostControlProtocol";
import { PORACODE_CLIENT_RUNTIME_VERSION, type ElectronHostBridge } from "@/shared/clientRuntime";
import {
  installBrowserClientRuntime,
  installElectronClientRuntime,
  resetClientRuntimeForTest,
} from "@/renderer/clientRuntime";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { I18nTestWrapper, renderWithI18n as render } from "@/renderer/testUtils/i18n";

vi.mock("@/renderer/views/MainView/parts/AppShell/AppShell", () => ({
  useSidebar: () => ({ isCollapsed: false, collapse: () => {}, expand: () => {} }),
}));

import { isSettingsSectionVisible, useSettingsShortcutDestinations } from "./settingsNavigation";
import { SettingsSidebar } from "./SettingsSidebar";
import type { SettingsSection } from "./types";

const SHOWN_IN_WINDOW: SettingsSection[] = [
  "agents",
  "skills",
  "search",
  "shortcuts",
  "mcpServers",
  "threads",
  "archived",
  "about",
];
const DESKTOP_ONLY_HIDDEN: SettingsSection[] = ["remoteAccess", "plugins", "browser", "xai"];
const WINDOW_BUTTONS = ["Skills", "MCP Servers", "Threads", "Archived Threads", "About"];
const HIDDEN_BUTTONS = ["Remote Access", "Plugins", "Browser", "xAI API"];

const agent = {
  kind: "agent-a",
  label: "Agent A",
  installed: true,
  authState: "authenticated",
} as AgentStatus;

function installBrowser(marker: boolean): void {
  const bridge = { arch: "web" } as unknown as PoracodeBridge;
  window.poracode = bridge;
  installBrowserClientRuntime(bridge);
  if (marker)
    Object.assign(window, { viscosityShell: Object.freeze({ kind: "tauri", version: 1 }) });
}

function installElectron(): void {
  const host = {
    clientRuntimeVersion: PORACODE_CLIENT_RUNTIME_VERSION,
    arch: "x64",
    platform: "darwin",
    hostCapabilities: hostServiceCapabilities({}),
    onSupervisorEvent: () => () => {},
    onBackendSupervisorReset: () => () => {},
    ipcProcedureMapVersion: IPC_PROCEDURE_MAP_VERSION,
    invokeProcedure: async () => undefined,
  } as unknown as ElectronHostBridge;
  window.poracodeHost = host;
  installElectronClientRuntime(host);
}

function visible(ids: SettingsSection[], remoteSession: boolean): SettingsSection[] {
  return ids.filter((id) => isSettingsSectionVisible(id, remoteSession));
}

function destinationIds(): string[] {
  useAgentStatusesStore.setState({ agentStatuses: [agent], wslAgentStatuses: [] });
  const { result } = renderHook(() => useSettingsShortcutDestinations(), {
    wrapper: I18nTestWrapper,
  });
  return result.current.map((destination) => destination.id);
}

function renderSidebar(): void {
  render(
    <SettingsSidebar
      activeSection="agentsGeneral"
      onSectionChange={() => {}}
      onClose={() => {}}
      installedAgents={[agent]}
      attentionAgentKinds={new Set()}
    />,
  );
}

function searchSidebar(query: string): void {
  fireEvent.change(screen.getByPlaceholderText("Search settings"), { target: { value: query } });
}

afterEach(() => {
  cleanup();
  resetClientRuntimeForTest();
  useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
  Reflect.deleteProperty(window, "poracode");
  Reflect.deleteProperty(window, "poracodeHost");
  Reflect.deleteProperty(window, "viscosityShell");
});

describe("Settings navigation in the host's own Tauri window", () => {
  it("shows the finished desktop-only sections but keeps the rest hidden", () => {
    installBrowser(true);
    expect(visible(SHOWN_IN_WINDOW, true)).toEqual(SHOWN_IN_WINDOW);
    expect(visible(DESKTOP_ONLY_HIDDEN, true)).toEqual([]);
    expect(destinationIds()).toEqual(
      expect.arrayContaining(["agentsGeneral", "acpRegistry", "agents:agent-a", "skills"]),
    );

    renderSidebar();
    expect(screen.getByRole("button", { name: "Agent Registry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent A$/ })).toBeInTheDocument();
    for (const name of WINDOW_BUTTONS)
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    for (const name of HIDDEN_BUTTONS)
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Models" })).not.toBeInTheDocument();

    searchSidebar("shared skills");
    expect(
      screen.getByText("Manage shared skills across global and project scopes."),
    ).toBeVisible();
    searchSidebar("confirm delete");
    expect(screen.getByText("Confirm before deleting threads")).toBeVisible();
    searchSidebar("unload idle");
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("keeps a plain browser client on today's sections and the Models row", () => {
    installBrowser(false);
    expect(visible([...SHOWN_IN_WINDOW, ...DESKTOP_ONLY_HIDDEN], true)).toEqual([]);
    const ids = destinationIds();
    expect(ids).toContain("agentsGeneral");
    expect(ids).not.toContain("acpRegistry");
    expect(ids.some((id) => id.startsWith("agents:"))).toBe(false);

    renderSidebar();
    expect(screen.getByRole("button", { name: "Models" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent Registry" })).not.toBeInTheDocument();
    for (const name of [...WINDOW_BUTTONS, ...HIDDEN_BUTTONS])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();

    searchSidebar("shared skills");
    expect(screen.getByText("No results")).toBeInTheDocument();
    searchSidebar("confirm delete");
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("leaves managed Electron unchanged even with a stray shell global", () => {
    installElectron();
    Object.assign(window, { viscosityShell: { kind: "tauri", version: 1 } });
    expect(visible(SHOWN_IN_WINDOW, false)).toEqual(SHOWN_IN_WINDOW);
    expect(destinationIds()).toEqual(expect.arrayContaining(["acpRegistry", "agents:agent-a"]));
  });
});
