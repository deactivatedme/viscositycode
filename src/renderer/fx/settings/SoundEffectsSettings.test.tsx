import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewSoundCue = vi.hoisted(() => vi.fn<(cue: string) => boolean>(() => true));

vi.mock("@/renderer/fx/sounds", () => ({ previewSoundCue }));

import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { FX_SETTINGS_STORAGE_KEY, useFxSettings } from "../fxSettingsStore";
import { SoundEffectsSettings } from "./SoundEffectsSettings";

const CUE_SWITCHES = ["Agent finished", "Agent error", "Needs your approval"];

function toggle(name: string) {
  const input = screen.getByRole("switch", { name });
  const track = input.closest(".switch")?.querySelector(".switch__control");
  fireEvent.click(track ?? input);
}

function volumeSlider(): HTMLInputElement {
  const group = screen.getByRole("group", { name: "Sound cue volume" });
  return within(group).getByRole("slider") as HTMLInputElement;
}

describe("SoundEffectsSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    previewSoundCue.mockClear();
  });

  it("starts off, with the rows under the master switch disabled", () => {
    render(<SoundEffectsSettings />);
    expect(screen.getByRole("switch", { name: "Sound cues" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Also when the app is in front" })).toBeDisabled();
    for (const name of CUE_SWITCHES) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
      expect(screen.getByRole("switch", { name })).toBeChecked();
    }
    expect(volumeSlider()).toBeDisabled();
    expect(volumeSlider().value).toBe("60");
  });

  it("writes the master switch, volume, front rule and each cue", () => {
    render(<SoundEffectsSettings />);
    toggle("Sound cues");
    expect(useFxSettings.getState().sounds.enabled).toBe(true);

    fireEvent.change(volumeSlider(), { target: { value: "35" } });
    expect(useFxSettings.getState().sounds.volume).toBe(0.35);

    toggle("Also when the app is in front");
    expect(useFxSettings.getState().sounds.alsoInFront).toBe(true);

    toggle("Agent error");
    toggle("Needs your approval");
    expect(useFxSettings.getState().sounds).toMatchObject({
      done: true,
      error: false,
      attention: false,
    });

    const stored = JSON.parse(localStorage.getItem(FX_SETTINGS_STORAGE_KEY)!) as {
      sounds: { volume: number; error: boolean };
    };
    expect(stored.sounds).toMatchObject({ volume: 0.35, error: false });
  });

  it("previews every cue, even before the pack is switched on", () => {
    render(<SoundEffectsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Play the finished sound" }));
    fireEvent.click(screen.getByRole("button", { name: "Play the error sound" }));
    fireEvent.click(screen.getByRole("button", { name: "Play the approval sound" }));
    expect(previewSoundCue.mock.calls).toEqual([["done"], ["error"], ["attention"]]);
    expect(useFxSettings.getState().sounds.enabled).toBe(false);
  });
});
