/**
 * ViscosityCode: fork-owned command palette entries.
 *
 * Fork features register their commands here instead of editing upstream's
 * command registry; upstream's registry spreads `viscosityCommands()` once.
 * Factories run each time the palette/keybindings read the command list, so
 * they may read store state for titles and `when` clauses.
 */
import type { AppCommand } from "@/renderer/commands/registry";

type CommandFactory = () => AppCommand[];

const factories = new Map<string, CommandFactory>();

/** Register (or replace) a feature's commands under a stable key. Returns an unregister function. */
export function registerViscosityCommands(key: string, factory: CommandFactory): () => void {
  factories.set(key, factory);
  return () => {
    if (factories.get(key) === factory) factories.delete(key);
  };
}

/** All fork commands, in registration order. A failing factory never breaks the palette. */
export function viscosityCommands(): AppCommand[] {
  const out: AppCommand[] = [];
  for (const factory of factories.values()) {
    try {
      out.push(...factory());
    } catch {
      // Skip a broken feature's commands; the rest of the palette keeps working.
    }
  }
  return out;
}
