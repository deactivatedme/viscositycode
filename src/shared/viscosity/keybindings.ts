/**
 * ViscosityCode: default shortcuts of the fork's own commands, spread into
 * upstream's `DEFAULT_KEYBINDINGS` (so they live in keybindings.json and stay
 * rebindable in Settings → Shortcuts) and into `BACKFILL_COMMAND_IDS` (so
 * existing keybinding files gain them once).
 *
 * The ids mirror `VISCOSITY_COMMAND_IDS` in the renderer (shared code cannot
 * import it); `defaultKeybindings.test.ts` checks every id is a registered
 * command. None of them shipped a default before, so the backfill is safe.
 *
 * macOS keeps Cmd+Option chords (VS Code's secondary-sidebar toggle is
 * Cmd+Option+B); Cmd+Shift+3/4/5 (macOS screenshots) is avoided. Windows and
 * Linux use Ctrl+Shift instead: Windows reports AltGr as Ctrl+Alt, so a
 * Ctrl+Alt+digit chord types "@" or "€" on many layouts and never fires.
 * Ctrl+Shift+B is the browser toggle, so the sidebar toggle takes Ctrl+Shift+Y.
 * None collides with an upstream default (`keybindings.test.ts` checks). They
 * stand down inside the terminal, where TUIs use Alt combos.
 */
import type { KeybindingEntry } from "../keybindings";

const OUTSIDE_TERMINAL = "!terminalFocus";

function shortcut(command: string, key: string, macKey: string): KeybindingEntry {
  return { command, key: `Ctrl+Shift+${key}`, mac: `Meta+Alt+${macKey}`, when: OUTSIDE_TERMINAL };
}

export const VISCOSITY_DEFAULT_KEYBINDINGS: readonly KeybindingEntry[] = [
  shortcut("viscosity.rightSidebar.toggle", "Y", "B"),
  shortcut("viscosity.view.sourceControl", "1", "1"),
  shortcut("viscosity.view.explorer", "2", "2"),
  shortcut("viscosity.view.notes", "3", "3"),
  shortcut("viscosity.view.usage", "4", "4"),
  shortcut("viscosity.view.browser", "5", "5"),
];

export const VISCOSITY_BACKFILL_COMMAND_IDS: readonly string[] = VISCOSITY_DEFAULT_KEYBINDINGS.map(
  (binding) => binding.command,
);
