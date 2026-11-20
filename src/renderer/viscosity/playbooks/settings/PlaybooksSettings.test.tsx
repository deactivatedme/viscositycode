import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { NOT_PROMOTED, FEATURE_CATALOG } from "@/renderer/components/newsLine/featureCatalog";
import { SETTINGS_SECTIONS } from "@/renderer/views/SettingsOverlay/parts/types";
import { MAX_PLAYBOOK_PHRASES, type SavedPlaybook } from "@/shared/viscosity/playbook";
import {
  DEFAULT_PLAYBOOK_VIEW_PREFS,
  getPlaybookViewPrefs,
  usePlaybookViewPrefsStore,
} from "../viewPrefs";
import { REVERSING_EXIT_PHRASES, REVERSING_SWITCH_PHRASES } from "../builtInPlaybooks";
import { draftFromPlaybook, playbookFromDraft } from "./PlaybookEditor";
import { PlaybooksSettings } from "./PlaybooksSettings";

const setPlaybooks = vi.fn<(playbooks: SavedPlaybook[]) => void>((playbooks) =>
  useSharedSettings.setState({ playbooks } as never),
);

beforeEach(() => {
  setPlaybooks.mockClear();
  useSharedSettings.setState({ playbooks: [], setPlaybooks } as never);
});
afterEach(() => {
  localStorage.clear();
  usePlaybookViewPrefsStore.setState(DEFAULT_PLAYBOOK_VIEW_PREFS);
});

describe("Settings → Playbooks", () => {
  it("toggles the device-local theme switch and no longer offers animation or CRT switches", () => {
    render(<PlaybooksSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Let playbooks change the theme" }));
    expect(getPlaybookViewPrefs().themeOverride).toBe(true);
    expect(screen.queryByRole("switch", { name: "Theme switch animation" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "CRT scanlines" })).toBeNull();
    expect(setPlaybooks).not.toHaveBeenCalled();
  });

  it("saves an edited built-in and resets it after confirming", async () => {
    render(<PlaybooksSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Reversing" }));
    const instructions = screen.getByRole("textbox", { name: "Playbook instructions" });
    fireEvent.change(instructions, { target: { value: "Only static analysis." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(setPlaybooks).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "reversing",
        instructions: "Only static analysis.",
      }),
    ]);
    await waitFor(() => expect(screen.getByText("Edited")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reset Reversing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    expect(setPlaybooks).toHaveBeenLastCalledWith([]);
  });

  it("shows Reversing setup on the two reversing editors, desktop only", async () => {
    render(<PlaybooksSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Live reversing" }));
    expect(screen.queryByRole("region", { name: "Reversing setup" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const checkEnvironment = vi.fn<() => Promise<unknown>>(async () => ({ status: "missing" }));
    Object.assign(window, { viscosityHost: { liveRe: { available: true, checkEnvironment } } });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Edit Live reversing" }));
      expect(await screen.findByRole("region", { name: "Reversing setup" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add IDA debugger server" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit Reversing" }));
      expect(await screen.findByRole("region", { name: "Reversing setup" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add IDA debugger server" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit Debug" }));
      expect(screen.queryByRole("region", { name: "Reversing setup" })).toBeNull();
    } finally {
      Reflect.deleteProperty(window, "viscosityHost");
    }
  });

  it("keeps the editor open with an error when the store cannot save", () => {
    useSharedSettings.setState({ setPlaybooks: undefined } as never);
    render(<PlaybooksSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Reversing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This playbook couldn't be saved.");
    expect(screen.getByRole("textbox", { name: "Playbook instructions" })).toBeInTheDocument();
  });

  it("keeps a playbook's switch and exit lines on save although no phrase box shows", () => {
    render(<PlaybooksSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Reversing" }));
    expect(screen.queryByRole("textbox", { name: "Switch lines" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Exit lines" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(setPlaybooks).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "reversing",
        switchPhrases: REVERSING_SWITCH_PHRASES.slice(0, MAX_PLAYBOOK_PHRASES),
        exitPhrases: REVERSING_EXIT_PHRASES.slice(0, MAX_PLAYBOOK_PHRASES),
      }),
    ]);
  });

  it("refuses to save without a name", () => {
    render(<PlaybooksSettings />);
    fireEvent.click(screen.getByRole("button", { name: "New playbook" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Playbook name" }), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Give the playbook a name and instructions.",
    );
    expect(setPlaybooks).not.toHaveBeenCalled();
  });
});

describe("playbook editor drafts", () => {
  it("round-trips a playbook, sanitizes lines and drops the theme for None", () => {
    const playbook: SavedPlaybook = {
      id: "c-0000abcd",
      label: "Mine",
      icon: "swords",
      instructions: "Do it.",
      themeId: "hostile-binary",
      switchPhrases: ["ONE"],
      mcp: ["ghidra"],
    };
    expect(playbookFromDraft(playbook.id, draftFromPlaybook(playbook))).toEqual(playbook);
    const draft = {
      ...draftFromPlaybook(playbook),
      themeId: "__none",
      switchPhrases: " A \n\nA\nB​ ",
      mcp: "ghidra, ida-pro-mcp,, ghidra",
    };
    expect(playbookFromDraft(playbook.id, draft)).toEqual({
      ...playbook,
      themeId: undefined,
      switchPhrases: ["A", "B"],
      mcp: ["ghidra", "ida-pro-mcp"],
    });
  });
});

describe("Playbooks section registration", () => {
  it("is a fixed section with a view and a feature discovery entry", () => {
    expect(SETTINGS_SECTIONS).toContain("playbooks");
    const overlay = readFileSync(
      join(import.meta.dirname, "../../../views/SettingsOverlay/SettingsOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toContain("playbooks: () => <PlaybooksSettings />");
    expect(FEATURE_CATALOG.some((feature) => feature.covers.includes("settings:playbooks"))).toBe(
      true,
    );
    expect("settings:playbooks" in NOT_PROMOTED).toBe(false);
  });
});
