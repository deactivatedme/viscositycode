// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { describe, expect, it } from "vitest";
import {
  bindingForPlatform,
  canonicalizeKeybinding,
  eventToKeybinding,
  formatCommandShortcut,
} from "./keybindingMatcher";

describe("formatCommandShortcut", () => {
  it("formats the first binding for a command per platform and tolerates unbound ids", () => {
    const keybindings = [
      { command: "palette.open", key: "Ctrl+Shift+P", mac: "Meta+Shift+P" },
      { command: "palette.open", key: "Ctrl+K", mac: "Meta+K" },
    ];

    expect(formatCommandShortcut("palette.open", keybindings, "darwin")).toBe("⌘⇧P");
    expect(formatCommandShortcut("palette.open", keybindings, "win32")).toBe("Ctrl+Shift+P");
    expect(formatCommandShortcut("editor.toggle-markdown-preview", keybindings, "linux")).toBe("");
  });

  it("skips a keyless removal stub and entries without a chord for this platform", () => {
    const keybindings = [
      { command: "thread.new" },
      { command: "thread.new", mac: "Meta+N" },
      { command: "thread.new", key: "Ctrl+Alt+N" },
    ];

    expect(formatCommandShortcut("thread.new", keybindings, "linux")).toBe("Ctrl+Alt+N");
    expect(formatCommandShortcut("thread.new", keybindings, "darwin")).toBe("⌘N");
    expect(formatCommandShortcut("thread.new", [{ command: "thread.new" }], "darwin")).toBe("");
  });
});

describe("keybindingMatcher", () => {
  it("chooses platform-specific bindings over the shared key", () => {
    const binding = {
      command: "palette.open",
      key: "Ctrl+Shift+P",
      mac: "Meta+Shift+P",
    };

    expect(bindingForPlatform(binding, "darwin")).toBe("Meta+Shift+P");
    expect(bindingForPlatform(binding, "linux")).toBe("Ctrl+Shift+P");
  });

  it("normalizes Mod to the platform command modifier", () => {
    expect(canonicalizeKeybinding("Mod+Shift+P", "darwin")).toBe("meta+shift+p");
    expect(canonicalizeKeybinding("Mod+Shift+P", "linux")).toBe("ctrl+shift+p");
  });

  it("normalizes keyboard events into the same canonical shape", () => {
    const event = new KeyboardEvent("keydown", {
      key: "P",
      metaKey: true,
      shiftKey: true,
    });

    expect(eventToKeybinding(event, "darwin")).toBe("meta+shift+p");
  });

  it.each(["Control", "Meta", "Alt", "Shift"])("ignores a modifier-only %s keydown", (key) => {
    expect(
      eventToKeybinding(
        {
          key,
          ctrlKey: key === "Control",
          metaKey: key === "Meta",
          altKey: key === "Alt",
          shiftKey: key === "Shift",
        },
        "win32",
      ),
    ).toBe("");
  });

  it("matches shifted-punctuation chords written with the base key", () => {
    // Holding Shift, the browser reports the shifted glyph ("}" for the "]" key),
    // while the binding is written with the base key. Both must canonicalize the
    // same so e.g. Ctrl+Shift+] (Next chat) actually fires.
    const next = new KeyboardEvent("keydown", { key: "}", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(next, "win32")).toBe("ctrl+shift+]");
    expect(canonicalizeKeybinding("Ctrl+Shift+]", "win32")).toBe("ctrl+shift+]");

    const previous = new KeyboardEvent("keydown", { key: "{", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(previous, "win32")).toBe("ctrl+shift+[");
    expect(canonicalizeKeybinding("Ctrl+Shift+[", "win32")).toBe("ctrl+shift+[");
  });
});

describe("eventToKeybinding with incomplete events", () => {
  it("ignores keyboard events that carry no key", () => {
    // Regression: synthetic events without `key` reached normalizeKeyPart and
    // crashed the renderer instead of simply matching no keybinding.
    const event = {
      key: undefined as unknown as string,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: false,
    };
    expect(() => eventToKeybinding(event, "darwin")).not.toThrow();
    expect(eventToKeybinding(event, "darwin")).toBe("");
  });
});

// ViscosityCode: macOS Cmd+Option chords report the Option glyph in `event.key`.
describe("eventToKeybinding with macOS Cmd+Option", () => {
  const chord = (init: KeyboardEventInit) =>
    new KeyboardEvent("keydown", { metaKey: true, altKey: true, ...init });

  it("names the physical key when Option produced a glyph or a dead key", () => {
    expect(eventToKeybinding(chord({ key: "∫", code: "KeyB" }), "darwin")).toBe("meta+alt+b");
    expect(eventToKeybinding(chord({ key: "Dead", code: "KeyN" }), "darwin")).toBe("meta+alt+n");
    expect(eventToKeybinding(chord({ key: "¡", code: "Digit1" }), "darwin")).toBe("meta+alt+1");
    expect(eventToKeybinding(chord({ key: "B", code: "KeyB" }), "darwin")).toBe("meta+alt+b");
  });

  it("leaves other chords and platforms on event.key (AltGr typing stays intact)", () => {
    expect(eventToKeybinding(chord({ key: "ArrowUp", code: "ArrowUp" }), "darwin")).toBe(
      "meta+alt+up",
    );
    const altGr = new KeyboardEvent("keydown", {
      key: "@",
      code: "Digit2",
      ctrlKey: true,
      altKey: true,
    });
    // German AltGr+Q types "@": text, never the Ctrl+Alt+2 chord.
    expect(eventToKeybinding(altGr, "win32")).toBe("");
    // Only Windows reports AltGr as Ctrl+Alt: elsewhere Ctrl+Alt+& is a real chord.
    const azerty = new KeyboardEvent("keydown", {
      key: "&",
      code: "Digit1",
      ctrlKey: true,
      altKey: true,
    });
    expect(eventToKeybinding(azerty, "linux")).toBe("ctrl+alt+7");
    expect(eventToKeybinding(azerty, "darwin")).toBe("ctrl+alt+7");
    const euro = new KeyboardEvent("keydown", { key: "€", ctrlKey: true, altKey: true });
    expect(eventToKeybinding(euro, "win32")).toBe("ctrl+alt+€");
    const digit = new KeyboardEvent("keydown", { key: "2", ctrlKey: true, altKey: true });
    expect(eventToKeybinding(digit, "win32")).toBe("ctrl+alt+2");
  });
});

// ViscosityCode: Windows/Linux layouts that report a symbol or a non-Latin letter.
describe("eventToKeybinding with non-US layouts on Windows/Linux", () => {
  const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("names the physical key for digit-row symbols and non-Latin letters", () => {
    // German Shift+2 is '"', Spanish Shift+3 is "·".
    const german = press({ key: '"', code: "Digit2", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(german, "win32")).toBe("ctrl+shift+2");
    const spanish = press({ key: "·", code: "Digit3", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(spanish, "win32")).toBe("ctrl+shift+3");
    // Turkish Q Shift+2 is "'", French-Canadian Shift+3 is "/": still the digit.
    const turkish = press({ key: "'", code: "Digit2", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(turkish, "win32")).toBe("ctrl+shift+2");
    const canadian = press({ key: "/", code: "Digit3", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(canadian, "win32")).toBe("ctrl+shift+3");
    // Czech unshifted 2 is "ě" (non-ASCII): the digit.
    expect(eventToKeybinding(press({ key: "ě", code: "Digit2", ctrlKey: true }), "win32")).toBe(
      "ctrl+2",
    );
    // Russian: B is "и", Y is "н".
    expect(eventToKeybinding(press({ key: "и", code: "KeyB", ctrlKey: true }), "win32")).toBe(
      "ctrl+b",
    );
    const russian = press({ key: "Н", code: "KeyY", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(russian, "linux")).toBe("ctrl+shift+y");
  });

  it("keeps Latin letters, plain typing and AltGr on event.key", () => {
    // AZERTY's KeyQ types "a": the layout letter wins.
    expect(eventToKeybinding(press({ key: "a", code: "KeyQ", ctrlKey: true }), "win32")).toBe(
      "ctrl+a",
    );
    expect(eventToKeybinding(press({ key: "и", code: "KeyB" }), "win32")).toBe("и");
    // Unshifted ASCII on a digit key keeps upstream's mapping: AZERTY Ctrl+- and Ctrl+&.
    expect(eventToKeybinding(press({ key: "-", code: "Digit6", ctrlKey: true }), "win32")).toBe(
      "ctrl+-",
    );
    expect(eventToKeybinding(press({ key: "&", code: "Digit1", ctrlKey: true }), "linux")).toBe(
      "ctrl+7",
    );
    // German Shift+7 is "/": the digit, like every other Shift+digit.
    const slash = press({ key: "/", code: "Digit7", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(slash, "linux")).toBe("ctrl+shift+7");
    // US Ctrl+Shift+1 is unchanged.
    const bang = press({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true });
    expect(eventToKeybinding(bang, "win32")).toBe("ctrl+shift+1");
    // Polish AltGr+N types "ń": text, never Ctrl+Alt+N (thread.new.panel).
    const altGr = press({ key: "ń", code: "KeyN", ctrlKey: true, altKey: true });
    expect(eventToKeybinding(altGr, "win32")).toBe("ctrl+alt+ń");
    const altGrDigit = press({ key: "²", code: "Digit2", ctrlKey: true, altKey: true });
    expect(eventToKeybinding(altGrDigit, "win32")).toBe("ctrl+alt+²");
  });
});
