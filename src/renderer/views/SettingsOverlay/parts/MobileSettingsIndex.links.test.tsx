import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { MobileSettingsIndex } from "./MobileSettingsIndex";

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(),
  issuesUrl: undefined as string | undefined,
}));

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  isRemoteSession: () => false,
  readBridge: () => ({ openExternal: mocks.openExternal }),
}));
vi.mock("@/shared/communityLinks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/communityLinks")>()),
  communityIssuesUrl: () => mocks.issuesUrl,
}));

function renderIndex() {
  renderWithI18n(
    <MobileSettingsIndex
      screen="device"
      hasDesktop
      showArchived={false}
      onOpenDesktop={() => {}}
      onOpenSchedules={() => {}}
      onOpenSection={() => {}}
    />,
  );
}

describe("MobileSettingsIndex external links (ViscosityCode)", () => {
  beforeEach(() => {
    mocks.openExternal.mockClear();
    mocks.issuesUrl = undefined;
  });

  it("has no privacy or support links to Poracode's website", () => {
    renderIndex();
    expect(screen.queryByRole("button", { name: /Privacy Policy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Support/ })).not.toBeInTheDocument();
  });

  it("opens the fork's issue tracker from Support once it exists", () => {
    mocks.issuesUrl = "https://github.com/owner/repo/issues";
    renderIndex();
    fireEvent.click(screen.getByRole("button", { name: /Support/ }));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/owner/repo/issues");
  });
});
