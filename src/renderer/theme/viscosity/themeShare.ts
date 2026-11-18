/**
 * ViscosityCode: "Share theme" for whichever theme is active, bundled or
 * custom. Both actions hand out the same version 1 document that Import theme
 * (file or link) accepts: "Copy JSON" puts it on the clipboard and "Save as
 * file" downloads it. The installation id never leaves the app.
 */
import {
  CUSTOM_THEME_VERSION,
  serializeThemeDocument,
  type CustomTheme,
  type ThemeDocument,
} from "@/shared/customThemes";
import { builtInThemeDocument, themeExportFilename } from "./themeExport";

/** The portable document for the theme the app shows for `themeId`. */
export function shareableThemeDocument(
  themeId: string,
  customThemes: readonly CustomTheme[],
): ThemeDocument | null {
  const custom = customThemes.find((theme) => theme.id === themeId);
  if (!custom) return builtInThemeDocument(themeId);
  return {
    version: CUSTOM_THEME_VERSION,
    label: custom.label,
    light: { ...custom.light },
    dark: { ...custom.dark },
  };
}

export interface SharedThemeFile {
  label: string;
  filename: string;
  json: string;
}

/** Serialized JSON + file name for sharing the theme shown for `themeId`. */
export function shareableThemeFile(
  themeId: string,
  customThemes: readonly CustomTheme[],
): SharedThemeFile | null {
  const doc = shareableThemeDocument(themeId, customThemes);
  if (!doc) return null;
  try {
    return {
      label: doc.label,
      filename: themeExportFilename(doc.label),
      json: serializeThemeDocument(doc),
    };
  } catch {
    // A record that no longer satisfies the schema is not shareable.
    return null;
  }
}

export type ClipboardWriter = (text: string) => Promise<void>;

function defaultClipboardWriter(): ClipboardWriter | null {
  if (typeof navigator === "undefined") return null;
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard || typeof clipboard.writeText !== "function") return null;
  return (text) => clipboard.writeText(text);
}

/** Copies `json`; resolves `false` when the clipboard is missing or refuses. */
export async function copyThemeJson(
  json: string,
  write: ClipboardWriter | null = defaultClipboardWriter(),
): Promise<boolean> {
  if (!write) return false;
  try {
    await write(json);
    return true;
  } catch {
    return false;
  }
}
