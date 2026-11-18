import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  clearStatusBarRegistry,
  getStatusBarItems,
} from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import {
  registerToolsRunningStatusItem,
  TOOLS_RUNNING_STATUS_ITEM_ID,
  ToolsRunningStatusItem,
} from "./ToolsRunningStatusItem";
import { setToolsRunningCount } from "./toolsRunningStore";

afterEach(() => {
  act(() => setToolsRunningCount(0));
  clearStatusBarRegistry();
});

describe("tools running status item", () => {
  it("is hidden at zero and shows the count in the tool tone", () => {
    const { container } = render(<ToolsRunningStatusItem />);
    expect(container.firstChild).toBeNull();

    act(() => setToolsRunningCount(3));
    const item = container.querySelector(`[data-vc-status-item="${TOOLS_RUNNING_STATUS_ITEM_ID}"]`);
    expect(item?.getAttribute("data-tone")).toBe("tool");
    expect(item?.querySelector(".vc-fx-spin")).not.toBeNull();
    expect(screen.getByText("3 tools running")).toBeTruthy();

    act(() => setToolsRunningCount(1));
    expect(screen.getByText("1 tool running")).toBeTruthy();

    act(() => setToolsRunningCount(0));
    expect(container.firstChild).toBeNull();
  });

  it("registers next to the agent counts and unregisters cleanly", () => {
    const unregister = registerToolsRunningStatusItem();
    const item = getStatusBarItems().find((entry) => entry.id === TOOLS_RUNNING_STATUS_ITEM_ID);
    expect(item?.align).toBe("left");
    expect(item?.order).toBe(205);
    unregister();
    expect(getStatusBarItems().some((entry) => entry.id === TOOLS_RUNNING_STATUS_ITEM_ID)).toBe(
      false,
    );
  });
});
