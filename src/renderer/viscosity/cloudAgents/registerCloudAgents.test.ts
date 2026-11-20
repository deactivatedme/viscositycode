import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { useMissionControlTabs } from "@/renderer/viscosity/missionControl/tabs";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { OPEN_CLOUD_AGENTS_COMMAND_ID } from "./paletteCommands";
import { CLOUD_AGENTS_TAB_ORDER, registerCloudAgents } from "./registerCloudAgents";

const openMissionControl = vi.hoisted(() => vi.fn<(options?: { tabId?: string }) => void>());

vi.mock("@/renderer/viscosity/missionControl/missionControlViewStore", () => ({
  openMissionControl,
}));
vi.mock("./ui/CloudAgentsTab", () => ({ CloudAgentsTab: () => null }));

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  openMissionControl.mockReset();
});

function openCommand() {
  return viscosityCommands().find((command) => command.id === OPEN_CLOUD_AGENTS_COMMAND_ID);
}

describe("registerCloudAgents", () => {
  it("adds the Cloud tab to Mission Control once, between Agents and Subscriptions", () => {
    registerCloudAgents();
    registerCloudAgents();
    const { result } = renderHook(() => useMissionControlTabs());
    const tabs = result.current.filter((tab) => tab.id === "cloud");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.order).toBe(CLOUD_AGENTS_TAB_ORDER);
    expect(CLOUD_AGENTS_TAB_ORDER).toBeGreaterThan(0);
    expect(CLOUD_AGENTS_TAB_ORDER).toBeLessThan(10);
  });

  it("offers Open Cloud agents in the desktop shell and opens that tab", () => {
    registerCloudAgents();
    expect(openCommand()?.showInPalette).toBe(false);

    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    const command = openCommand();
    expect(command?.showInPalette).toBeUndefined();
    void command?.run();
    expect(openMissionControl).toHaveBeenCalledWith({ tabId: "cloud" });
  });
});
