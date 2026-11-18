import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { DEFAULT_FX_SETTINGS, FX_SETTINGS_STORAGE_KEY, useFxSettings } from "../fxSettingsStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { EffectsSettings } from "./EffectsSettings";
import { EFFECTS_SETTINGS_SEARCH_ENTRIES } from "./effectsSettingsSearch";

const CHILD_EFFECTS = [
  "Thinking glow",
  "Streaming energy",
  "Tool activity indicator",
  "Attention color when an agent needs you",
  "Error flash",
  "Completion animation",
  "Typing glow",
];

const BACKGROUND_SWITCHES = [
  "Pause when the window is not focused",
  "Pause when the system asks to reduce motion",
  "Battery saver",
];

/** Flip a switch through its visible track, as a pointer user would. */
function toggle(name: string) {
  const input = screen.getByRole("switch", { name });
  const track = input.closest(".switch")?.querySelector(".switch__control");
  fireEvent.click(track ?? input);
}

function slider(name: string): HTMLInputElement {
  const group = screen.getByRole("group", { name });
  return within(group).getByRole("slider") as HTMLInputElement;
}

describe("EffectsSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    delete document.documentElement.dataset.windowKind;
  });

  afterEach(() => {
    act(() => usePanelStore.getState().clearSettingsSection());
    delete document.documentElement.dataset.windowKind;
  });

  it("renders every searchable row with the exact indexed text", () => {
    const { container } = render(<EffectsSettings />);

    // Search shows the indexed strings, so they must be the row's own text.
    const mismatches: string[] = [];
    for (const entry of EFFECTS_SETTINGS_SEARCH_ENTRIES) {
      const row = container.querySelector<HTMLElement>(`[data-settings-anchor="${entry.anchor}"]`);
      const expected = [entry.title, ...(entry.description ? [entry.description] : [])];
      for (const descriptor of expected) {
        const text = i18n._(descriptor);
        if (!row?.textContent?.includes(text)) mismatches.push(`${entry.anchor}: "${text}"`);
      }
    }
    expect(mismatches).toEqual([]);
    const rendered = [...container.querySelectorAll("[data-settings-anchor]")].map(
      (element) => element.getAttribute("data-settings-anchor") ?? "",
    );
    expect(rendered.toSorted()).toEqual(
      EFFECTS_SETTINGS_SEARCH_ENTRIES.map((entry) => entry.anchor).toSorted(),
    );
  });

  it("starts from the defaults, with the reduced-motion pause off", () => {
    render(<EffectsSettings />);

    expect(screen.getByRole("switch", { name: "Animated background" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Pause when the system asks to reduce motion" }),
    ).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Agent effects" })).toBeChecked();
    // The 0.7 default sits on the slider's 5% grid.
    expect(slider("Background intensity").value).toBe("70");
    expect(slider("Panel opacity").value).toBe("78");
    expect(slider("Panel blur").value).toBe("20");
  });

  it("writes background switches, selects and sliders to the fx store", async () => {
    render(<EffectsSettings />);

    toggle("Pause when the system asks to reduce motion");
    expect(useFxSettings.getState().background.respectReducedMotion).toBe(true);
    toggle("Battery saver");
    expect(useFxSettings.getState().background.batterySaver).toBe(false);
    toggle("Pause when the window is not focused");
    expect(useFxSettings.getState().background.pauseWhenUnfocused).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Background style/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Aurora grid" }));
    await waitFor(() => expect(useFxSettings.getState().background.preset).toBe("aurora"));

    fireEvent.click(screen.getByRole("button", { name: /Frame-rate cap/ }));
    fireEvent.click(await screen.findByRole("option", { name: "60 fps" }));
    await waitFor(() => expect(useFxSettings.getState().background.fpsCap).toBe(60));

    fireEvent.change(slider("Background intensity"), { target: { value: "30" } });
    expect(useFxSettings.getState().background.intensity).toBe(0.3);
    fireEvent.change(slider("Panel opacity"), { target: { value: "60" } });
    expect(useFxSettings.getState().background.panelOpacity).toBe(0.6);
    fireEvent.change(slider("Panel blur"), { target: { value: "25" } });
    expect(useFxSettings.getState().background.panelBlur).toBe(25);

    // Persisted as this device's preference.
    const stored = JSON.parse(localStorage.getItem(FX_SETTINGS_STORAGE_KEY)!) as {
      background: { preset: string; fpsCap: number; panelBlur: number };
    };
    expect(stored.background).toMatchObject({ preset: "aurora", fpsCap: 60, panelBlur: 25 });
  });

  it("disables the background rows while the animated background is off", () => {
    render(<EffectsSettings />);

    toggle("Animated background");
    expect(useFxSettings.getState().background.enabled).toBe(false);

    expect(screen.getByRole("switch", { name: "Animated background" })).not.toBeDisabled();
    for (const name of BACKGROUND_SWITCHES) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
    for (const name of ["Background intensity", "Panel opacity", "Panel blur"]) {
      expect(slider(name)).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /Background style/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Frame-rate cap/ })).toBeDisabled();
  });

  it("writes each agent effect and disables them all behind the master switch", () => {
    render(<EffectsSettings />);

    toggle("Error flash");
    expect(useFxSettings.getState().effects.errorFlash).toBe(false);
    toggle("Typing glow");
    expect(useFxSettings.getState().effects.typingGlow).toBe(false);

    toggle("Agent effects");
    expect(useFxSettings.getState().effects.enabled).toBe(false);
    for (const name of CHILD_EFFECTS) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
    // Children keep their own values for when the master comes back on.
    expect(screen.getByRole("switch", { name: "Thinking glow" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Error flash" })).not.toBeChecked();

    toggle("Agent effects");
    for (const name of CHILD_EFFECTS) {
      expect(screen.getByRole("switch", { name })).not.toBeDisabled();
    }
  });

  it("resets every effect setting to the defaults", () => {
    render(<EffectsSettings />);
    const resetButton = screen.getByRole("button", { name: /^Reset$/ });
    expect(resetButton).toBeDisabled();

    toggle("Agent effects");
    toggle("Animated background");
    fireEvent.change(slider("Panel blur"), { target: { value: "3" } });
    expect(resetButton).not.toBeDisabled();

    fireEvent.click(resetButton);

    const { background, effects } = useFxSettings.getState();
    expect({ background, effects }).toEqual(DEFAULT_FX_SETTINGS);
    expect(screen.getByRole("switch", { name: "Agent effects" })).toBeChecked();
    expect(resetButton).toBeDisabled();
  });

  it("links approval alerts to the existing notification settings", () => {
    useSharedSettings.setState({
      notificationsEnabled: true,
      notificationStatuses: { done: true, needsAttention: false, error: true },
    });
    render(<EffectsSettings />);

    const row = document.querySelector<HTMLElement>(
      '[data-settings-anchor="effects.approvalNotifications"]',
    )!;
    expect(within(row).getByText("Off")).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: /Open notification settings/ }));

    expect(usePanelStore.getState().settingsSection).toBe("notifications");
    expect(usePanelStore.getState().settingsAnchor).toBe("notifications.notifyNeedsAttention");
  });

  it("explains that effects are off outside the desktop main window", () => {
    const { unmount } = render(<EffectsSettings />);
    expect(screen.getByRole("note")).toHaveTextContent(/desktop layout of the main window/);
    unmount();

    document.documentElement.dataset.windowKind = "main";
    render(<EffectsSettings />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
