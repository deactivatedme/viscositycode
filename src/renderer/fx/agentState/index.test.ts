import { afterEach, describe, expect, it, vi } from "vitest";
import { getStatusBarItems } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { installAgentStateDevHook } from "./devHook";
import { startAgentStateEffects } from "./index";
import { TOOLS_RUNNING_STATUS_ITEM_ID } from "./ToolsRunningStatusItem";

type FxWindow = { __viscosityFx?: Record<string, unknown> };

afterEach(() => {
  delete (window as FxWindow).__viscosityFx;
});

describe("agent-state dev hook", () => {
  it("joins the shared namespace without replacing other keys", () => {
    const target: FxWindow = { __viscosityFx: { background: "kept" } };
    const hook = { snapshot: vi.fn<() => never[]>(() => []), simulate: vi.fn<() => void>() };
    const uninstall = installAgentStateDevHook(hook, target);
    expect(target.__viscosityFx).toEqual({ background: "kept", agentState: hook });
    uninstall();
    expect(target.__viscosityFx).toEqual({ background: "kept" });
  });

  it("leaves a newer hook in place on a stale uninstall", () => {
    const target: FxWindow = {};
    const first = { snapshot: vi.fn<() => never[]>(() => []), simulate: vi.fn<() => void>() };
    const second = { snapshot: vi.fn<() => never[]>(() => []), simulate: vi.fn<() => void>() };
    const uninstallFirst = installAgentStateDevHook(first, target);
    installAgentStateDevHook(second, target);
    uninstallFirst();
    expect(target.__viscosityFx?.agentState).toBe(second);
  });
});

describe("startAgentStateEffects", () => {
  it("registers the status item and the DEV hook, and tears both down", () => {
    const stop = startAgentStateEffects(document);
    expect(getStatusBarItems().some((item) => item.id === TOOLS_RUNNING_STATUS_ITEM_ID)).toBe(true);
    const hook = (window as FxWindow).__viscosityFx?.agentState as
      | { snapshot(): unknown[] }
      | undefined;
    expect(Array.isArray(hook?.snapshot())).toBe(true);
    stop();
    expect(getStatusBarItems().some((item) => item.id === TOOLS_RUNNING_STATUS_ITEM_ID)).toBe(
      false,
    );
    expect((window as FxWindow).__viscosityFx?.agentState).toBeUndefined();
  });
});
