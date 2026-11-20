import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { CursorCloudSetupHint } from "./cloudAgentsSetupHint";

describe("CursorCloudSetupHint", () => {
  it("names the real settings path and opens Cursor's settings page", () => {
    const openAgentSettings = vi.fn<(agentKind: string) => void>();
    render(<CursorCloudSetupHint openAgentSettings={openAgentSettings} />);

    expect(
      screen.getByText(
        "In Settings → Agents → Cursor → Profiles, add a profile with a User API key, then set Run in to Cursor Cloud.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Cursor settings" }));
    expect(openAgentSettings).toHaveBeenCalledWith("cursor");
  });
});
