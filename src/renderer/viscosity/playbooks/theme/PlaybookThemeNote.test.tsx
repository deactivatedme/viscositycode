import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { setAppThemeOverride } from "@/renderer/theme/applyAppTheme";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { PlaybookThemeNote } from "./PlaybookThemeNote";
import { getPlaybookViewPrefs, setPlaybookViewPrefs } from "../viewPrefs";

describe("PlaybookThemeNote", () => {
  beforeEach(() => {
    useSharedSettings.setState({ themePreset: "github", customThemes: [] });
    setPlaybookViewPrefs({ themeOverride: true });
  });

  afterEach(() => {
    act(() => setAppThemeOverride(null));
    localStorage.clear();
  });

  it("renders nothing without an override, for the saved theme, or for a deleted preset", () => {
    const { container } = render(<PlaybookThemeNote />);
    expect(container.firstChild).toBeNull();

    act(() => setAppThemeOverride("github"));
    expect(container.firstChild).toBeNull();

    act(() => setAppThemeOverride("deleted-custom-theme"));
    expect(container.firstChild).toBeNull();
  });

  it("names the playbook theme on screen instead of the saved one", () => {
    render(<PlaybookThemeNote />);
    act(() => setAppThemeOverride("hostile-binary"));

    expect(screen.getByRole("status").textContent).toContain("Hostile Binary");
    expect(screen.getByRole("button", { name: "Turn off playbook themes" })).toBeTruthy();
  });

  it("turns playbook themes off on this device", () => {
    render(<PlaybookThemeNote />);
    act(() => setAppThemeOverride("hostile-binary"));

    fireEvent.click(screen.getByRole("button", { name: "Turn off playbook themes" }));
    expect(getPlaybookViewPrefs().themeOverride).toBe(false);
  });
});
