import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { useMissionControlTabs } from "@/renderer/viscosity/missionControl/tabs";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { OPEN_SUBSCRIPTIONS_COMMAND_ID } from "./paletteCommands";
import { registerSubscriptions, SUBSCRIPTIONS_TAB_ORDER } from "./registerSubscriptions";

const openMissionControl = vi.hoisted(() => vi.fn<(options?: { tabId?: string }) => void>());

vi.mock("@/renderer/viscosity/missionControl/missionControlViewStore", () => ({
  openMissionControl,
}));
vi.mock("./ui/SubscriptionsTab", () => ({ SubscriptionsTab: () => null }));

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  openMissionControl.mockReset();
});

function openCommand() {
  return viscosityCommands().find((command) => command.id === OPEN_SUBSCRIPTIONS_COMMAND_ID);
}

describe("registerSubscriptions", () => {
  it("adds the Subscriptions tab to Mission Control once, after Agents", () => {
    registerSubscriptions();
    registerSubscriptions();
    const { result } = renderHook(() => useMissionControlTabs());
    const tabs = result.current.filter((tab) => tab.id === "subscriptions");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.order).toBe(SUBSCRIPTIONS_TAB_ORDER);
  });

  it("offers Open Subscriptions in the desktop shell and opens that tab", () => {
    registerSubscriptions();
    expect(openCommand()?.showInPalette).toBe(false);

    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    const command = openCommand();
    expect(command?.showInPalette).toBeUndefined();
    void command?.run();
    expect(openMissionControl).toHaveBeenCalledWith({ tabId: "subscriptions" });
  });
});
