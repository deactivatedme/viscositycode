import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { XaiKeyStatus } from "@/shared/viscosity/xaiContract";
import { i18n } from "@/renderer/i18n/i18n";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { createFakeXaiBridge, type FakeXaiBridge } from "../testing/fakeXaiBridge";
import { useXaiKeyStore } from "../useXaiKeyStatus";
import { XaiSettings } from "./XaiSettings";
import { XAI_SETTINGS_SEARCH_ENTRIES } from "./xaiSettingsSearch";

let bridge: FakeXaiBridge;

function installBridge(): void {
  bridge = createFakeXaiBridge();
  window.viscosityHost = { xai: bridge };
  useXaiKeyStore.setState({ available: true, status: undefined, loading: false, error: undefined });
}

function keyInput(): HTMLInputElement {
  return screen.getByLabelText("xAI API key", { selector: "input" });
}

function statusLine(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-vc-xai-key-status]")!;
}

describe("Settings → xAI API", () => {
  beforeEach(() => {
    installBridge();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "viscosityHost");
    useXaiKeyStore.setState({
      available: false,
      status: undefined,
      loading: false,
      error: undefined,
    });
  });

  it("renders every searchable row with the exact indexed text", () => {
    const { container } = render(<XaiSettings />);
    const mismatches: string[] = [];
    for (const entry of XAI_SETTINGS_SEARCH_ENTRIES) {
      const row = container.querySelector<HTMLElement>(`[data-settings-anchor="${entry.anchor}"]`);
      for (const descriptor of [entry.title, ...(entry.description ? [entry.description] : [])]) {
        const text = i18n._(descriptor);
        if (!row?.textContent?.includes(text)) mismatches.push(`${entry.anchor}: "${text}"`);
      }
    }
    expect(mismatches).toEqual([]);
    const rendered = [...container.querySelectorAll("[data-settings-anchor]")].map(
      (element) => element.getAttribute("data-settings-anchor") ?? "",
    );
    expect(rendered.toSorted()).toEqual(
      XAI_SETTINGS_SEARCH_ENTRIES.map((entry) => entry.anchor).toSorted(),
    );
  });

  it("shows a stored key by its last four characters only", async () => {
    render(<XaiSettings />);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("stored"));
    expect(statusLine().textContent).toContain("…WXYZ");
    expect(keyInput().value).toBe("");
    expect(keyInput().type).toBe("password");
    expect(screen.getByRole("button", { name: "Remove" })).not.toBeDisabled();
  });

  it("saves a pasted key to the main process and clears the field", async () => {
    bridge.keyStatusValue = { configured: false, source: "none" };
    render(<XaiSettings />);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("none"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();

    fireEvent.change(keyInput(), { target: { value: "  xai-secret-key-1234  " } });
    bridge.keyStatusValue = { configured: true, source: "stored", hint: "1234" };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(bridge.setKey).toHaveBeenCalledWith("xai-secret-key-1234");
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("stored"));
    expect(statusLine().textContent).toContain("…1234");
    expect(keyInput().value).toBe("");
  });

  it("removes a stored key", async () => {
    render(<XaiSettings />);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("stored"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });
    expect(bridge.clearKey).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("none"));
  });

  it("explains that XAI_API_KEY wins and has nothing to remove", async () => {
    bridge.keyStatusValue = { configured: true, source: "env", hint: "ABCD" };
    render(<XaiSettings />);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("env"));
    expect(statusLine().textContent).toContain("XAI_API_KEY");
    expect(statusLine().textContent).toContain("…ABCD");
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("still removes a stored key while XAI_API_KEY takes precedence over it", async () => {
    // Additive status field: main reports a key saved on this device even when env wins.
    const envAndStored: XaiKeyStatus & { hasStoredKey?: boolean } = {
      configured: true,
      source: "env",
      hint: "ABCD",
      hasStoredKey: true,
    };
    bridge.keyStatusValue = envAndStored;
    vi.mocked(bridge.clearKey).mockResolvedValueOnce({
      configured: true,
      source: "env",
      hint: "ABCD",
    });
    render(<XaiSettings />);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("env"));
    expect(statusLine().textContent).toContain("XAI_API_KEY");
    expect(statusLine().textContent).toContain("…ABCD");
    expect(statusLine().textContent).toContain(
      "takes precedence over the key saved on this device",
    );
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(remove);
    });
    expect(bridge.clearKey).toHaveBeenCalledTimes(1);
    // The environment key still applies; nothing is left to remove.
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled());
    expect(statusLine().dataset.vcXaiKeyStatus).toBe("env");
    expect(statusLine().textContent).toContain("It takes precedence over a saved key.");
  });

  it("explains a saved key that cannot be read and lets it be removed", async () => {
    const unreadable: XaiKeyStatus & { hasStoredKey?: boolean } = {
      configured: false,
      source: "none",
      hasStoredKey: true,
    };
    bridge.keyStatusValue = unreadable;
    render(<XaiSettings />);
    await waitFor(() => expect(statusLine().dataset.vcXaiKeyStatus).toBe("none"));
    expect(statusLine().textContent).toBe(
      "A saved key can't be read on this device. Remove it or save a new one.",
    );
    expect(screen.getByRole("button", { name: "Remove" })).not.toBeDisabled();
  });

  it("says the key is desktop-only where there is no xAI bridge", () => {
    Reflect.deleteProperty(window, "viscosityHost");
    useXaiKeyStore.setState({
      available: false,
      status: undefined,
      loading: false,
      error: undefined,
    });
    render(<XaiSettings />);
    expect(statusLine().textContent).toBe("Grok over the xAI API works only in the desktop app.");
    expect(keyInput()).toBeDisabled();
    expect(bridge.keyStatus).not.toHaveBeenCalled();
  });
});
