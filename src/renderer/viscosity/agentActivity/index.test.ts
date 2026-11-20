import { describe, expect, it } from "vitest";
import { getStatusBarItems } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { startAgentActivity } from "./index";
import { TOOLS_RUNNING_STATUS_ITEM_ID } from "./ToolsRunningStatusItem";

describe("startAgentActivity", () => {
  it("registers the tools status item and tears it down", () => {
    const stop = startAgentActivity();
    expect(getStatusBarItems().some((item) => item.id === TOOLS_RUNNING_STATUS_ITEM_ID)).toBe(true);
    stop();
    expect(getStatusBarItems().some((item) => item.id === TOOLS_RUNNING_STATUS_ITEM_ID)).toBe(
      false,
    );
  });
});
