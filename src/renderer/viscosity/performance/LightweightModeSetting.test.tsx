import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { LightweightModeSetting } from "./LightweightModeSetting";
import { resetLowMemoryCacheForTests } from "./lightweight";
import { FX_SETTINGS_STORAGE_KEY, usePerformanceSettings } from "./performanceSettingsStore";

const GiB = 1024 ** 3;

function setHost(system: Record<string, unknown>): void {
  (globalThis as { viscosityHost?: unknown }).viscosityHost = { system };
}

describe("LightweightModeSetting", () => {
  beforeEach(() => {
    localStorage.clear();
    usePerformanceSettings.getState().setLightweight("auto");
    resetLowMemoryCacheForTests();
  });

  afterEach(() => {
    delete (globalThis as { viscosityHost?: unknown }).viscosityHost;
    delete document.documentElement.dataset.windowKind;
    resetLowMemoryCacheForTests();
  });

  it("promises glass and animation changes only in the desktop layout", () => {
    setHost({ totalMemoryBytes: 32 * GiB, lowPowerGraphics: false });
    const { unmount } = render(<LightweightModeSetting />);
    expect(screen.getByText(/change only in the desktop layout/)).toBeInTheDocument();
    unmount();
    document.documentElement.dataset.windowKind = "main";
    render(<LightweightModeSetting />);
    expect(screen.getByText(/no window glass, fewer animations/)).toBeInTheDocument();
  });

  it("names low memory when Auto turns on for it", () => {
    setHost({ totalMemoryBytes: 8 * GiB, lowPowerGraphics: false });
    render(<LightweightModeSetting />);
    expect(screen.getByText("On for this device: 8 GB of memory or less")).toBeInTheDocument();
  });

  it("names the graphics rule when Auto turns on with plenty of memory", () => {
    setHost({ totalMemoryBytes: 32 * GiB, lowPowerGraphics: true });
    render(<LightweightModeSetting />);
    expect(
      screen.getByText("On for this device: no usable GPU, or a Remote Desktop session"),
    ).toBeInTheDocument();
  });

  it("gives no reason when Auto is off or the mode is forced on", () => {
    setHost({ totalMemoryBytes: 32 * GiB, lowPowerGraphics: false });
    const { unmount } = render(<LightweightModeSetting />);
    expect(screen.getByText("Off for this device")).toBeInTheDocument();
    unmount();
    usePerformanceSettings.getState().setLightweight("on");
    render(<LightweightModeSetting />);
    expect(screen.getByText("On for this device")).toBeInTheDocument();
  });

  it("anchors the row for settings search and writes the chosen mode", async () => {
    setHost({ totalMemoryBytes: 32 * GiB, lowPowerGraphics: false });
    const { container } = render(<LightweightModeSetting />);
    expect(
      container.querySelector('[data-settings-anchor="appearance.lightweight"]'),
    ).not.toBeNull();
    usePerformanceSettings.getState().setLightweight("on");
    expect(await screen.findByText("On for this device")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(FX_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 1,
      performance: { lightweight: "on" },
    });
  });
});
