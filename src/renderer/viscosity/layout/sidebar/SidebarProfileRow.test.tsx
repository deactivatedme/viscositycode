// ViscosityCode: the desktop shell's sidebar profile row keeps upstream's What's New entry.
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useChangelogStore } from "@/renderer/state/changelogStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { SidebarProfileRow } from "./SidebarProfileRow";

const initial = useChangelogStore.getState();

afterEach(() => {
  useChangelogStore.setState(initial, true);
});

function renderRow() {
  return render(<SidebarProfileRow remoteAccessStatus="off" showRemoteAccess={false} />);
}

describe("SidebarProfileRow", () => {
  it("shows the What's New entry above the account row and opens the dialog", () => {
    useChangelogStore.setState({ whatsNewHidden: false, whatsNewOpen: false });
    renderRow();
    const entry = screen.getByRole("button", { name: "What's New" });
    const account = screen.getByRole("button", { name: "Account menu" });
    expect(entry.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(entry);
    expect(useChangelogStore.getState().whatsNewOpen).toBe(true);
  });

  it("leaves the entry out once hidden with nothing unread", () => {
    useChangelogStore.setState({ whatsNewHidden: true, releases: [] });
    renderRow();
    expect(screen.queryByRole("button", { name: "What's New" })).toBeNull();
  });
});
