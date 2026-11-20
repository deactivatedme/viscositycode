import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStatusBarItems } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { TOOLS_RUNNING_STATUS_ITEM_ID } from "./agentActivity/ToolsRunningStatusItem";
import { usePerformanceSettings } from "./performance/performanceSettingsStore";
import { threadOnScreenOverride } from "./threadVisibilityHook";
import { LIGHTWEIGHT_ATTRIBUTE, ViscosityShellRuntime } from "./ViscosityShellRuntime";

const shell = vi.hoisted(() => ({ on: true }));
const onScreen = vi.hoisted(() => ({ answer: true }));
vi.mock("@/renderer/viscosity/shellFlag", () => ({ useViscosityShellFlag: () => shell.on }));
vi.mock("@/renderer/viscosity/threadOnScreen", () => ({
  isThreadOnScreen: () => onScreen.answer,
}));

const root = document.documentElement;
const toolsItemRegistered = () =>
  getStatusBarItems().some((item) => item.id === TOOLS_RUNNING_STATUS_ITEM_ID);

describe("ViscosityShellRuntime", () => {
  beforeEach(() => {
    localStorage.clear();
    usePerformanceSettings.getState().setLightweight("off");
    shell.on = true;
  });

  afterEach(cleanup);

  it("registers the on-screen rule and the tools item in the shell, and clears both on unmount", () => {
    const { unmount } = render(<ViscosityShellRuntime />);
    onScreen.answer = false;
    expect(threadOnScreenOverride("t1")).toBe(false);
    onScreen.answer = true;
    expect(threadOnScreenOverride("t1")).toBe(true);
    expect(toolsItemRegistered()).toBe(true);
    unmount();
    expect(threadOnScreenOverride("t1")).toBeUndefined();
    expect(toolsItemRegistered()).toBe(false);
  });

  it("marks <html> while Lightweight mode is on in the shell", () => {
    const { unmount } = render(<ViscosityShellRuntime />);
    // Unknown memory in jsdom: Off stays off.
    expect(root.hasAttribute(LIGHTWEIGHT_ATTRIBUTE)).toBe(false);
    act(() => usePerformanceSettings.getState().setLightweight("on"));
    expect(root.hasAttribute(LIGHTWEIGHT_ATTRIBUTE)).toBe(true);
    act(() => usePerformanceSettings.getState().setLightweight("off"));
    expect(root.hasAttribute(LIGHTWEIGHT_ATTRIBUTE)).toBe(false);
    act(() => usePerformanceSettings.getState().setLightweight("on"));
    unmount();
    expect(root.hasAttribute(LIGHTWEIGHT_ATTRIBUTE)).toBe(false);
  });

  it("does nothing outside the desktop shell", () => {
    shell.on = false;
    usePerformanceSettings.getState().setLightweight("on");
    render(<ViscosityShellRuntime />);
    expect(root.hasAttribute(LIGHTWEIGHT_ATTRIBUTE)).toBe(false);
    expect(threadOnScreenOverride("t1")).toBeUndefined();
    expect(toolsItemRegistered()).toBe(false);
  });
});
