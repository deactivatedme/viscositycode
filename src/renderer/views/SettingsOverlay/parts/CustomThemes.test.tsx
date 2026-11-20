// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { downloadTextFile } from "@/renderer/utils/downloadTextFile";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { AppProvider } from "@/renderer/components/ui/provider";
import { OverlayShell } from "@/renderer/components/layout/OverlayShell";
import { ThemeGallery } from "./ThemeGallery";

vi.mock("@/renderer/utils/downloadTextFile", () => ({
  downloadTextFile: vi.fn<typeof downloadTextFile>(),
}));

beforeEach(() => {
  localStorage.clear();
  useSharedSettings.setState({ themePreset: "default", themeMode: "dark", customThemes: [] });
});

describe("custom theme settings", () => {
  it("creates, applies, edits and deletes a custom theme through the settings UI", async () => {
    render(
      <AppProvider syncWindowChrome={false}>
        <ThemeGallery />
      </AppProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    expect(screen.getByRole("dialog", { name: "Custom theme" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Theme name" }), {
      target: { value: "Personal blue" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Background" }), {
      target: { value: "#101010" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Composer background" }), {
      target: { value: "#141414" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    await waitFor(() => expect(useSharedSettings.getState().customThemes).toHaveLength(1));
    const id = useSharedSettings.getState().customThemes[0]!.id;
    expect(useSharedSettings.getState().themePreset).toBe(id);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#101010");
    expect(
      JSON.parse(localStorage.getItem("poracode-shared-settings")!).customThemes[0].label,
    ).toBe("Personal blue");
    fireEvent.click(screen.getByRole("button", { name: "Edit theme" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Background" }), {
      target: { value: "#202020" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--background")).toBe("#202020"),
    );
    expect(useSharedSettings.getState().customThemes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete theme" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(useSharedSettings.getState().themePreset).toBe("default"));
    expect(useSharedSettings.getState().customThemes).toEqual([]);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });
  it("blocks invalid palettes and cancels without changing settings", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Background" }), {
      target: { value: "#xyz" },
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Background" }));
    expect(screen.getByRole("textbox", { name: "Background" })).toHaveValue("#xyz");
    expect(screen.getByRole("button", { name: "Save and apply" })).toBeDisabled();
    expect(
      screen.getByText("Enter a theme name and valid hex colors in both palettes."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useSharedSettings.getState().customThemes).toEqual([]);
    expect(useSharedSettings.getState().themePreset).toBe("default");
  });
  it("dismisses the modal without saving and discards the draft when reopened", async () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    const dialog = screen.getByRole("dialog", { name: "Custom theme" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Theme name" }), {
      target: { value: "Unsaved palette" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Close$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useSharedSettings.getState().customThemes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    expect(screen.getByRole("textbox", { name: "Theme name" })).toHaveValue("My theme");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useSharedSettings.getState().themePreset).toBe("default");
  });
  it("dismisses nested picker and palette menus before the editor and settings overlay", async () => {
    const onExited = vi.fn<() => void>();
    const { container } = render(
      <OverlayShell open instantEnter onExited={onExited}>
        <ThemeGallery />
      </OverlayShell>,
    );
    const overlay = container.querySelector("[data-overlay-surface]")!;
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose color for Accent" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Hex color" }), {
      key: "Escape",
      code: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Hex color" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "Custom theme" })).toBeInTheDocument();
    expect(overlay).toHaveAttribute("data-overlay-visible");
    fireEvent.click(screen.getByRole("button", { name: "Dark Palette mode" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Custom theme" })).toBeInTheDocument();
    expect(overlay).toHaveAttribute("data-overlay-visible");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(overlay).toHaveAttribute("data-overlay-visible");
    expect(useSharedSettings.getState().customThemes).toEqual([]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Create custom theme" }), {
      key: "Escape",
      code: "Escape",
    });
    fireEvent.transitionEnd(overlay, { propertyName: "opacity" });
    expect(onExited).toHaveBeenCalledOnce();
  });
  it("shows live contrast guidance for both palettes without blocking save", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    const disclosure = screen.getByRole("button", { name: /^Text contrast/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "Text contrast" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Text color" }), {
      target: { value: "#000000" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Content background" }), {
      target: { value: "#000000" },
    });
    expect(disclosure).toHaveTextContent("Low contrast");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    const table = screen.getByRole("table", { name: "Text contrast" });
    expect(within(table).getByRole("columnheader", { name: "Light" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Dark" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Content background/ })).toHaveTextContent(
      "1.00:1Low contrast",
    );
    expect(screen.getByRole("button", { name: "Save and apply" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Text color" }), {
      target: { value: "#ffffff" },
    });
    expect(within(table).getByRole("row", { name: /Content background/ })).toHaveTextContent(
      "21.00:1Good contrast",
    );
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "Text contrast" })).not.toBeInTheDocument();
  });
  it("syncs typed and picked colors, recovers invalid input, and restores automatic fills", async () => {
    // ViscosityCode: the Viscosity base spec authors an explicit composer fill,
    // so start from a bundled preset whose composer is still automatic.
    useSharedSettings.setState({ themePreset: "github" });
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    expect(screen.getAllByRole("button", { name: /^Choose color for/ })).toHaveLength(10);
    fireEvent.change(screen.getByRole("textbox", { name: "Accent" }), {
      target: { value: "#abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose color for Accent" }));
    const hex = screen.getByRole("textbox", { name: "Hex color" });
    expect(hex).toHaveValue("#AABBCC");
    fireEvent.change(hex, { target: { value: "#123456" } });
    fireEvent.blur(hex);
    fireEvent.keyDown(hex, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Hex color" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Accent" })).toHaveValue("#123456");

    fireEvent.change(screen.getByRole("textbox", { name: "Background" }), {
      target: { value: "#xyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose color for Background" }));
    const invalidHex = screen.getByRole("textbox", { name: "Hex color" });
    fireEvent.change(invalidHex, { target: { value: "#202020" } });
    fireEvent.blur(invalidHex);
    fireEvent.keyDown(invalidHex, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Hex color" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Background" })).toHaveValue("#202020");
    expect(screen.getByRole("button", { name: "Save and apply" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Choose color for Composer background" }));
    expect(useSharedSettings.getState().customThemes).toEqual([]);
    expect(screen.getByRole("button", { name: "Automatic" })).toBeDisabled();
    const hue = screen.getByRole("slider", { name: "Hue" });
    fireEvent.keyDown(hue, { key: "ArrowRight" });
    expect(hue).toHaveValue("1");
    const composerHex = screen.getByRole("textbox", { name: "Hex color" });
    fireEvent.change(composerHex, { target: { value: "#303030" } });
    fireEvent.blur(composerHex);
    expect(screen.getByRole("button", { name: "Automatic" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
    expect(composerHex).toHaveFocus();
    expect(screen.getByRole("button", { name: "Automatic" })).toBeDisabled();
    fireEvent.keyDown(composerHex, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Hex color" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Composer background" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    await waitFor(() => expect(useSharedSettings.getState().customThemes).toHaveLength(1));
    expect(useSharedSettings.getState().customThemes[0]!.dark.composer).toBeUndefined();
    expect(useSharedSettings.getState().customThemes[0]!.dark.accent).toBe("#123456");
  });
  it("opens on the current appearance and identifies an invalid hidden palette", async () => {
    useSharedSettings.setState({ themeMode: "light" });
    render(
      <AppProvider syncWindowChrome={false}>
        <ThemeGallery />
      </AppProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    expect(screen.getByRole("button", { name: "Light Palette mode" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Background" }), {
      target: { value: "#12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Light Palette mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    await waitFor(() =>
      expect(screen.getByText("Check the Light palette for invalid colors.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save and apply" })).toBeDisabled();
  });
  it("exports a versioned document without persisting a draft or including its installation id", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Export theme" }));
    const [filename, json, type] = vi.mocked(downloadTextFile).mock.calls[0]!;
    expect(filename).toBe("viscositycode-theme.json");
    expect(type).toBe("application/json");
    expect(JSON.parse(json)).toMatchObject({ version: 1, label: "My theme" });
    expect(JSON.parse(json)).not.toHaveProperty("id");
    expect(useSharedSettings.getState().customThemes).toEqual([]);
  });
  it("exports the active built-in preset as an importable JSON document", async () => {
    vi.mocked(downloadTextFile).mockClear();
    render(<ThemeGallery />);
    // ViscosityCode: built-in export now lives under Share theme → Save as file.
    fireEvent.click(screen.getByRole("button", { name: "Share theme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save as file" }));
    const [filename, json, type] = vi.mocked(downloadTextFile).mock.calls[0]!;
    expect(filename).toBe("viscosity-theme.json");
    expect(type).toBe("application/json");
    expect(JSON.parse(json)).toMatchObject({
      version: 1,
      label: "Viscosity",
      dark: { bg: "#000000", accent: "#ffffff" },
    });
    expect(JSON.parse(json)).not.toHaveProperty("id");
    expect(useSharedSettings.getState().customThemes).toEqual([]);
  });
  // ViscosityCode: Share theme covers custom themes too, without the installation id.
  it("shares the active custom theme instead of the bundled preset", async () => {
    vi.mocked(downloadTextFile).mockClear();
    const custom = {
      version: 1 as const,
      id: "custom:active",
      label: "Active custom",
      light: {
        bg: "#ffffff",
        surface: "#ffffff",
        fg: "#111111",
        accent: "#0055aa",
        accentFg: "#ffffff",
        border: "#dddddd",
      },
      dark: {
        bg: "#111111",
        surface: "#161616",
        fg: "#eeeeee",
        accent: "#66aaff",
        accentFg: "#001122",
        border: "#333333",
      },
    };
    useSharedSettings.setState({ customThemes: [custom], themePreset: custom.id });
    render(<ThemeGallery />);
    expect(screen.getByRole("button", { name: "Edit theme" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share theme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save as file" }));
    const [filename, json, type] = vi.mocked(downloadTextFile).mock.calls[0]!;
    expect(filename).toBe("active-custom-theme.json");
    expect(type).toBe("application/json");
    expect(JSON.parse(json)).toEqual({
      version: 1,
      label: "Active custom",
      light: custom.light,
      dark: custom.dark,
    });
    expect(useSharedSettings.getState().customThemes).toEqual([custom]);
  });
  it("does not reopen a stale imported theme after Create and Cancel", async () => {
    render(<ThemeGallery />);
    const { THEME_SPECS } = await import("@/renderer/theme/themePresets");
    const pending = Promise.withResolvers<string>();
    const file = new File([], "slow.json");
    Object.defineProperty(file, "text", { value: () => pending.promise });
    fireEvent.change(screen.getByLabelText("Import theme", { selector: "input" }), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create custom theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      pending.resolve(JSON.stringify({ ...THEME_SPECS[0]!, version: 1, label: "Late import" }));
      await pending.promise;
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useSharedSettings.getState().customThemes).toEqual([]);
  });
  it("imports with a fresh id and rejects unsupported files", async () => {
    render(<ThemeGallery />);
    const { THEME_SPECS } = await import("@/renderer/theme/themePresets");
    const doc = {
      ...THEME_SPECS[0]!,
      version: 1,
      id: "custom:existing",
      label: "Imported palette",
    };
    const file = new File([], "theme.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(doc) });
    fireEvent.change(screen.getByLabelText("Import theme", { selector: "input" }), {
      target: { files: [file] },
    });
    const dialog = await screen.findByRole("dialog", { name: "Custom theme" });
    expect(within(dialog).getByRole("textbox", { name: "Theme name" })).toHaveValue(
      "Imported palette",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    expect(useSharedSettings.getState().customThemes[0]!.id).not.toBe(doc.id);
    const bad = new File([], "future.json");
    Object.defineProperty(bad, "text", {
      value: async () => JSON.stringify({ ...doc, version: 2 }),
    });
    fireEvent.change(screen.getByLabelText("Import theme", { selector: "input" }), {
      target: { files: [bad] },
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not import"));
    expect(useSharedSettings.getState().customThemes).toHaveLength(1);
  });
});

// ViscosityCode: import from a link (desktop bridge), de-duplicated imports and Copy JSON.
describe("theme links and sharing", () => {
  const night = {
    bg: "#101010",
    surface: "#161616",
    fg: "#eeeeee",
    accent: "#66aaff",
    accentFg: "#001122",
    border: "#333333",
  };
  const sharedDoc = {
    version: 1 as const,
    label: "Shared night",
    light: { ...night, bg: "#ffffff", fg: "#111111" },
    dark: night,
  };
  const LINK = "https://themes.example.com/night.json";

  function installBridge(reply: (url: string) => Promise<unknown>) {
    const fetchTheme = vi.fn<(url: string) => Promise<unknown>>(reply);
    Reflect.set(window, "viscosityHost", { themes: { available: true, fetchTheme } });
    return fetchTheme;
  }

  function openUrlDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Import from URL…" }));
    return screen.getByRole("dialog", { name: "Import theme from URL" });
  }

  function submitLink(dialog: HTMLElement, url: string) {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Theme link" }), {
      target: { value: url },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "viscosityHost");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("offers link import only where the desktop download bridge exists", () => {
    render(<ThemeGallery />);
    expect(screen.queryByRole("button", { name: "Import from URL…" })).not.toBeInTheDocument();
  });

  it("refuses non-https links in the dialog without downloading", async () => {
    const fetchTheme = installBridge(async () => null);
    render(<ThemeGallery />);
    const dialog = openUrlDialog();
    // Ready to paste: the link field has focus as soon as the dialog opens.
    await waitFor(() =>
      expect(within(dialog).getByRole("textbox", { name: "Theme link" })).toHaveFocus(),
    );
    submitLink(dialog, "http://themes.example.com/night.json");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Only secure https:// links can be imported.",
    );
    submitLink(dialog, "   ");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Paste a link to a theme JSON file.",
    );
    expect(fetchTheme).not.toHaveBeenCalled();
  });

  it("explains download, size, timeout and schema failures and saves nothing", async () => {
    const replies = [
      { ok: false, error: { code: "too-large" } },
      { ok: false, error: { code: "timeout" } },
      { ok: false, error: { code: "http-error", status: 404 } },
      { ok: true, value: { text: JSON.stringify({ ...sharedDoc, version: 2 }), url: LINK } },
    ];
    const fetchTheme = installBridge(async () => replies.shift());
    render(<ThemeGallery />);
    const dialog = openUrlDialog();
    for (const expected of [
      "The file is larger than 32 KB.",
      "The server did not respond within 10 seconds.",
      "The server answered with an error (HTTP 404).",
      "The link does not point to a version 1 theme JSON file",
    ]) {
      submitLink(dialog, LINK);
      await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(expected));
    }
    expect(fetchTheme).toHaveBeenCalledTimes(4);
    expect(fetchTheme).toHaveBeenLastCalledWith(LINK);
    expect(screen.queryByRole("dialog", { name: "Custom theme" })).not.toBeInTheDocument();
    expect(useSharedSettings.getState().customThemes).toEqual([]);
  });

  it("opens a downloaded theme for review under a unique name and a fresh id", async () => {
    const taken = { ...sharedDoc, id: "custom:taken", dark: { ...night, accent: "#ff0000" } };
    useSharedSettings.setState({ customThemes: [taken] });
    installBridge(async () => ({
      ok: true,
      value: { text: JSON.stringify(sharedDoc), url: LINK },
    }));
    render(<ThemeGallery />);
    submitLink(openUrlDialog(), ` ${LINK} `);
    const editor = await screen.findByRole("dialog", { name: "Custom theme" });
    expect(screen.queryByRole("dialog", { name: "Import theme from URL" })).not.toBeInTheDocument();
    expect(within(editor).getByRole("textbox", { name: "Theme name" })).toHaveValue(
      "Shared night (2)",
    );
    expect(useSharedSettings.getState().customThemes).toEqual([taken]);
    fireEvent.click(within(editor).getByRole("button", { name: "Save and apply" }));
    await waitFor(() => expect(useSharedSettings.getState().customThemes).toHaveLength(2));
    const added = useSharedSettings.getState().customThemes[1]!;
    expect(added).toMatchObject({ label: "Shared night (2)", dark: night });
    expect(added.id).not.toBe(taken.id);
    expect(useSharedSettings.getState().themePreset).toBe(added.id);
  });

  it("applies an installed theme with the same colors instead of adding a copy", async () => {
    const existing = {
      ...sharedDoc,
      id: "custom:mine",
      label: "My night",
      dark: { ...night, accent: "#66AAFF" },
    };
    useSharedSettings.setState({ customThemes: [existing] });
    installBridge(async () => ({
      ok: true,
      value: { text: JSON.stringify(sharedDoc), url: LINK },
    }));
    render(<ThemeGallery />);
    submitLink(openUrlDialog(), LINK);
    await waitFor(() => expect(useSharedSettings.getState().themePreset).toBe(existing.id));
    expect(
      screen.getByText(/already installed as “My night”, so that theme was applied/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useSharedSettings.getState().customThemes).toEqual([existing]);
    // The notice belongs to that import: it does not return when the theme is chosen again later.
    act(() => useSharedSettings.getState().setThemePreset("default"));
    act(() => useSharedSettings.getState().setThemePreset(existing.id));
    expect(screen.queryByText(/already installed/)).not.toBeInTheDocument();
  });

  it("de-duplicates file imports the same way", async () => {
    const existing = { ...sharedDoc, id: "custom:mine", label: "My night" };
    useSharedSettings.setState({ customThemes: [existing] });
    render(<ThemeGallery />);
    const file = new File([], "night.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(sharedDoc) });
    fireEvent.change(screen.getByLabelText("Import theme", { selector: "input" }), {
      target: { files: [file] },
    });
    await waitFor(() => expect(useSharedSettings.getState().themePreset).toBe(existing.id));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useSharedSettings.getState().customThemes).toEqual([existing]);
  });

  it("drops a download that finishes after the dialog was cancelled", async () => {
    const pending = Promise.withResolvers<unknown>();
    installBridge(() => pending.promise);
    render(<ThemeGallery />);
    const dialog = openUrlDialog();
    submitLink(dialog, LINK);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => {
      pending.resolve({ ok: true, value: { text: JSON.stringify(sharedDoc), url: LINK } });
      await pending.promise;
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useSharedSettings.getState().customThemes).toEqual([]);
  });

  it("copies the active theme's JSON to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const installed = { ...sharedDoc, id: "custom:night" };
    useSharedSettings.setState({ customThemes: [installed], themePreset: installed.id });
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Share theme" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual(sharedDoc);
  });
});
