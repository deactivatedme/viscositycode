import { act, cleanup, renderHook } from "@testing-library/react";
import type { Monaco } from "@monaco-editor/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as terminalColors from "@/renderer/components/terminal/terminalColors";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { setAppThemeOverride } from "@/renderer/theme/applyAppTheme";
import { MONACO_THEME_NAMES, defineAppThemes, useResolvedTheme } from "./monacoThemes";

type DefinedTheme = { colors: Record<string, string> };

function fakeMonaco() {
  const defineTheme = vi.fn<(name: string, data: DefinedTheme) => void>();
  return { monaco: { editor: { defineTheme } } as unknown as Monaco, defineTheme };
}

function lastDefinition(defineTheme: ReturnType<typeof fakeMonaco>["defineTheme"], name: string) {
  const calls = defineTheme.mock.calls.filter(([theme]) => theme === name);
  return calls.at(-1)?.[1];
}

const root = document.documentElement;

beforeEach(() => {
  // jsdom has no canvas; resolve plain hex values directly.
  vi.spyOn(terminalColors, "resolveTerminalColor").mockImplementation((value) => value || null);
  root.classList.add("dark");
  root.style.setProperty("--accent", "#ff8800");
  root.style.setProperty("--foreground", "#eeeeee");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  root.classList.remove("dark", "light");
  root.style.removeProperty("--accent");
  root.style.removeProperty("--foreground");
});

describe("app Monaco themes", () => {
  it("keeps the stable theme names callers pass to the editor", () => {
    expect(MONACO_THEME_NAMES).toEqual({ dark: "poracode-dark", light: "poracode-light" });
  });

  it("builds the active theme from live CSS variables and the other from fallbacks", () => {
    const { monaco, defineTheme } = fakeMonaco();
    defineAppThemes(monaco);
    expect(lastDefinition(defineTheme, "poracode-dark")?.colors["editorCursor.foreground"]).toBe(
      "#ff8800",
    );
    expect(lastDefinition(defineTheme, "poracode-dark")?.colors["editor.background"]).toBe(
      "#00000000",
    );
    expect(lastDefinition(defineTheme, "poracode-light")?.colors["editorCursor.foreground"]).toBe(
      "#0279bb",
    );
    // The active theme is defined last so Monaco repaints it in place.
    expect(defineTheme.mock.calls.at(-1)?.[0]).toBe("poracode-dark");
  });

  it("redefines the themes when the preset changes", async () => {
    const { monaco, defineTheme } = fakeMonaco();
    defineAppThemes(monaco);
    const previous = useSharedSettings.getState().themePreset;
    renderHook(() => useResolvedTheme());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    defineTheme.mockClear();
    try {
      root.style.setProperty("--accent", "#00aa55");
      act(() => useSharedSettings.setState({ themePreset: "github" }));
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(lastDefinition(defineTheme, "poracode-dark")?.colors["editorCursor.foreground"]).toBe(
        "#00aa55",
      );
    } finally {
      act(() => useSharedSettings.setState({ themePreset: previous }));
    }
  });

  it("redefines the themes when a playbook theme override switches in and out", async () => {
    const { monaco, defineTheme } = fakeMonaco();
    defineAppThemes(monaco);
    renderHook(() => useResolvedTheme());
    const nextFrame = () =>
      act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    await nextFrame();
    try {
      defineTheme.mockClear();
      root.style.setProperty("--accent", "#00ff41");
      act(() => setAppThemeOverride("hostile-binary"));
      await nextFrame();
      expect(lastDefinition(defineTheme, "poracode-dark")?.colors["editorCursor.foreground"]).toBe(
        "#00ff41",
      );

      defineTheme.mockClear();
      act(() => setAppThemeOverride(null));
      await nextFrame();
      expect(defineTheme).toHaveBeenCalled();
    } finally {
      act(() => setAppThemeOverride(null));
    }
  });
});
