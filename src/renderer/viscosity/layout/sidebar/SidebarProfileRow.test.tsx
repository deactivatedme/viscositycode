// ViscosityCode: the desktop shell's sidebar profile row keeps upstream's What's New entry.
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@/shared/contracts";
import { useChangelogStore } from "@/renderer/state/changelogStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  PROFILE_NAME_STORAGE_KEY,
  readStoredProfileName,
  useProfileNameStore,
} from "./profileNameStore";
import { SidebarProfileRow } from "./SidebarProfileRow";

const initial = useChangelogStore.getState();
const initialUsage = useProviderUsageStore.getState();
const shellGlobal = globalThis as { viscosityHost?: unknown };

afterEach(() => {
  useChangelogStore.setState(initial, true);
  useProviderUsageStore.setState(initialUsage, true);
  useProfileNameStore.setState({ name: null });
  localStorage.removeItem(PROFILE_NAME_STORAGE_KEY);
  delete shellGlobal.viscosityHost;
});

function renderRow() {
  return render(<SidebarProfileRow remoteAccessStatus="off" showRemoteAccess={false} />);
}

function signIn(authenticatedAs: string, plan: string) {
  const snapshot = { providerId: "one", status: "ok", windows: [], fetchedAt: 1 } as UsageSnapshot;
  useProviderUsageStore.setState({ snapshots: { one: { ...snapshot, authenticatedAs, plan } } });
}

function account() {
  return screen.getByRole("button", { name: "Account menu" });
}

function startRename() {
  fireEvent.click(account());
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Your name" });
}

describe("SidebarProfileRow", () => {
  it("shows the What's New entry above the account row and opens the dialog", () => {
    useChangelogStore.setState({ whatsNewHidden: false, whatsNewOpen: false });
    renderRow();
    const entry = screen.getByRole("button", { name: "What's New" });
    expect(
      entry.compareDocumentPosition(account()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(entry);
    expect(useChangelogStore.getState().whatsNewOpen).toBe(true);
  });

  it("leaves the entry out once hidden with nothing unread", () => {
    useChangelogStore.setState({ whatsNewHidden: true, releases: [] });
    renderRow();
    expect(screen.queryByRole("button", { name: "What's New" })).toBeNull();
  });

  it("shows the OS account name from the shell, with no provider plan", () => {
    shellGlobal.viscosityHost = { system: { userName: "Sam Doe" } };
    signIn("someone@example.com", "Ultra");
    renderRow();
    expect(account()).toHaveTextContent(/^SSam Doe$/);
  });

  it("falls back to the signed-in account, then Account, when no shell names the user", () => {
    // A phone, a plain browser, or a shell from before `userName` (other system facts only).
    shellGlobal.viscosityHost = { system: { totalMemoryBytes: 1, lowPowerGraphics: false } };
    const { unmount } = renderRow();
    expect(account()).toHaveTextContent(/^AAccount$/);
    unmount();
    signIn("someone@example.com", "Ultra");
    renderRow();
    expect(account()).toHaveTextContent(/^Ssomeone$/);
  });

  it("renames from the menu: Enter saves and the typed name wins and persists", () => {
    shellGlobal.viscosityHost = { system: { userName: "Sam Doe" } };
    renderRow();
    const input = startRename();
    expect(input).toHaveFocus();
    expect(input.value).toBe("Sam Doe");
    expect(input.closest("[inert], [aria-hidden='true']")).toBeNull();
    fireEvent.change(input, { target: { value: "  Sammy  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(account()).toHaveTextContent(/^SSammy$/);
    expect(account()).toHaveFocus();
    expect(localStorage.getItem(PROFILE_NAME_STORAGE_KEY)).toBe("Sammy");
    expect(readStoredProfileName()).toBe("Sammy");
  });

  it("returns to the OS default when the name is cleared", () => {
    shellGlobal.viscosityHost = { system: { userName: "Sam Doe" } };
    useProfileNameStore.getState().setName("Sammy");
    renderRow();
    const input = startRename();
    expect(input.value).toBe("Sammy");
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.blur(input);
    expect(account()).toHaveTextContent(/^SSam Doe$/);
    expect(localStorage.getItem(PROFILE_NAME_STORAGE_KEY)).toBeNull();
  });

  it("keeps the name on Escape, and does not store an unchanged default", () => {
    shellGlobal.viscosityHost = { system: { userName: "Sam Doe" } };
    renderRow();
    const cancelled = startRename();
    fireEvent.change(cancelled, { target: { value: "Nope" } });
    fireEvent.keyDown(cancelled, { key: "Escape" });
    expect(account()).toHaveTextContent(/^SSam Doe$/);
    fireEvent.keyDown(startRename(), { key: "Enter" });
    expect(account()).toHaveTextContent(/^SSam Doe$/);
    expect(localStorage.getItem(PROFILE_NAME_STORAGE_KEY)).toBeNull();
  });

  it("reads a stored name sanitized, and nothing before the first rename", () => {
    expect(readStoredProfileName()).toBeNull();
    localStorage.setItem(PROFILE_NAME_STORAGE_KEY, `  ${"x".repeat(200)}  `);
    expect(readStoredProfileName()).toHaveLength(80);
    localStorage.setItem(PROFILE_NAME_STORAGE_KEY, "   ");
    expect(readStoredProfileName()).toBeNull();
  });
});
