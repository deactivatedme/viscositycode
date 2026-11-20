// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { bindingForPlatform, type KeybindingEntry } from "@/shared/keybindings";

export { bindingForPlatform };

const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"] as const;
export type PlatformName = "darwin" | "win32" | "linux" | NodeJS.Platform;

/** The subset of a keyboard event needed to derive a chord. Lets callers pass a
 * real `KeyboardEvent` or a lightweight stand-in (e.g. the composer's intercept
 * event) without depending on the full DOM type. */
export type ChordEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
> &
  Partial<Pick<KeyboardEvent, "code">>; // ViscosityCode: optional physical key (see physicalChordKey)

export function formatKeybinding(raw: string | undefined, platform: PlatformName): string {
  if (!raw) return "";
  const canonical = canonicalizeKeybinding(raw, platform);
  if (!canonical) return raw;
  return canonical
    .split("+")
    .map((part) => {
      if (platform === "darwin") {
        if (part === "meta") return "⌘";
        if (part === "shift") return "⇧";
        if (part === "alt") return "⌥";
        if (part === "ctrl") return "⌃";
      }
      if (part === "meta") return "Meta";
      if (part === "ctrl") return "Ctrl";
      if (part === "alt") return "Alt";
      if (part === "shift") return "Shift";
      if (part.length === 1) return part.toUpperCase();
      return part[0]!.toUpperCase() + part.slice(1);
    })
    .join(platform === "darwin" ? "" : "+");
}

/**
 * Format the chord bound to `commandId` for display, or "" when unbound. Uses
 * the first matching entry, mirroring dispatch order in the keybinding hook.
 */
export function formatCommandShortcut(
  commandId: string,
  keybindings: readonly KeybindingEntry[],
  platform: PlatformName,
): string {
  // ViscosityCode: skip keyless removal stubs ({ command }) and other-platform entries, as dispatch does.
  const binding = keybindings.find(
    (item) => item.command === commandId && bindingForPlatform(item, platform),
  );
  if (!binding) return "";
  return formatKeybinding(bindingForPlatform(binding, platform), platform);
}

export function eventToKeybinding(event: ChordEvent, platform: PlatformName): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");

  if (isAltGrGlyph(event, platform)) return ""; // ViscosityCode: AltGr typing is text, not a chord
  const key = normalizeKeyPart(physicalChordKey(event, platform) ?? event.key, platform); // ViscosityCode:
  if (!key || MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) return "";
  parts.push(key);
  return canonicalizeParts(parts, platform);
}

/**
 * ViscosityCode: name a chord by its physical key (`KeyB`, `Digit1`) when
 * `event.key` would never match the binding.
 * - macOS Cmd+Option: Option turns `event.key` into a glyph ("∫" for B) or
 *   "Dead", and Cmd+Option never types text.
 * - Windows/Linux Ctrl, Alt or Meta chords: the digit row reports layout symbols
 *   (German Shift+2 '"', Turkish Shift+2 "'", Czech "ě"), and non-Latin layouts report
 *   their own letter (Russian "и" for B). Ctrl+Alt stays on `event.key`: on
 *   Windows it is AltGr, which types text.
 * shortcut: maps by US physical position, so on other layouts the letter is the
 * QWERTY one; upgrade to `navigator.keyboard.getLayoutMap()` if that matters.
 */
function physicalChordKey(event: ChordEvent, platform: PlatformName): string | undefined {
  if (/^[a-z0-9]$/i.test(event.key ?? "")) return undefined;
  const match = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? "");
  if (!match) return undefined;
  if (platform === "darwin")
    return event.metaKey && event.altKey ? (match[1] ?? match[2]) : undefined;
  if (!(event.ctrlKey || event.altKey || event.metaKey)) return undefined;
  if (event.ctrlKey && event.altKey) return undefined;
  const ascii = /^[\x20-\x7e]$/.test(event.key ?? "");
  // Shift+digit names the digit whatever symbol the layout types (Turkish Shift+2
  // is "'"). Unshifted ASCII keeps upstream's mapping: AZERTY Ctrl+- stays ctrl+-
  // and Ctrl+& stays ctrl+7, so bindings recorded before still match.
  if (match[2]) return event.shiftKey || !ascii ? match[2] : undefined;
  return ascii ? undefined : match[1];
}

/**
 * ViscosityCode: Windows reports AltGr as Ctrl+Alt. A shifted-punctuation glyph
 * it types without Shift ("@" from AltGr+Q on a German layout) is text; mapping
 * it back to its US base key would turn typing "@" into Ctrl+Alt+2. Linux
 * reports AltGr as AltGraph and macOS Ctrl+Option is a real chord, so only win32.
 */
function isAltGrGlyph(event: ChordEvent, platform: PlatformName): boolean {
  return (
    platform === "win32" &&
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    typeof event.key === "string" &&
    Object.hasOwn(SHIFTED_PUNCTUATION, event.key)
  );
}

export function canonicalizeKeybinding(raw: string, platform: PlatformName): string | undefined {
  const parts = raw
    .split("+")
    .map((part) => normalizeKeyPart(part.trim(), platform))
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  return canonicalizeParts(parts, platform);
}

function canonicalizeParts(parts: string[], platform: PlatformName): string {
  const modifiers = new Set<string>();
  const main: string[] = [];
  for (const part of parts) {
    const normalized = normalizeKeyPart(part, platform);
    if (!normalized) continue;
    if (MODIFIER_ORDER.includes(normalized as (typeof MODIFIER_ORDER)[number])) {
      modifiers.add(normalized);
    } else {
      main.push(normalized);
    }
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), ...main].join("+");
}

function normalizeKeyPart(part: string | undefined, platform: PlatformName): string | undefined {
  // The global keydown listener forwards every event here, and synthetic or
  // stand-in events can arrive without `key`. Reading it unguarded threw and,
  // because the listener has no boundary, took down the whole renderer.
  const lower = part?.toLowerCase();
  if (!lower) return undefined;
  if (lower === "cmd" || lower === "command" || lower === "super" || lower === "win") {
    return "meta";
  }
  if (lower === "control") return "ctrl";
  if (lower === "option") return "alt";
  if (lower === "mod") return platform === "darwin" ? "meta" : "ctrl";
  return normalizeMainKey(lower);
}

/**
 * US-layout shifted punctuation → its base key. While Shift is held the browser
 * reports the shifted glyph in `event.key` (pressing `]` yields `}`), so without
 * this a binding written with the base key (`Ctrl+Shift+]`) would never match
 * the event it describes. Mapping the glyph back keeps Shift in the chord, so
 * `Ctrl+Shift+]` resolves identically whether it came from a binding string or a
 * live keystroke. Non-US layouts that produce these glyphs from other keys fall
 * outside this best-effort mapping.
 */
const SHIFTED_PUNCTUATION: Record<string, string> = {
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};

function normalizeMainKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "escape") return "esc";
  if (lower === "arrowup") return "up";
  if (lower === "arrowdown") return "down";
  if (lower === "arrowleft") return "left";
  if (lower === "arrowright") return "right";
  return SHIFTED_PUNCTUATION[lower] ?? lower;
}
