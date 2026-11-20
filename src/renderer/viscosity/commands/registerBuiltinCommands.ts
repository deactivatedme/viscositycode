/**
 * ViscosityCode: registers the fork's built-in palette commands (themes,
 * account pools, layout) with the fork command registry once.
 * Feature-owned commands (Roundtable, Mission Control, Subscriptions, …)
 * register from their own modules.
 */
import { accountPoolCommands } from "./accountPoolCommands";
import { layoutCommands } from "./layoutCommands";
import { themeCommands } from "./themeCommands";
import { registerViscosityCommands } from "./viscosityCommands";

/** Registry keys, in palette order. */
export const BUILTIN_VISCOSITY_COMMAND_KEYS = {
  theme: "viscosity.theme",
  accountPools: "viscosity.accountPools",
  layout: "viscosity.layout",
} as const;

let registered = false;

/** Idempotent: registers every built-in command group once per renderer. */
export function registerBuiltinViscosityCommands(): void {
  if (registered) return;
  registered = true;
  registerViscosityCommands(BUILTIN_VISCOSITY_COMMAND_KEYS.theme, themeCommands);
  registerViscosityCommands(BUILTIN_VISCOSITY_COMMAND_KEYS.accountPools, accountPoolCommands);
  registerViscosityCommands(BUILTIN_VISCOSITY_COMMAND_KEYS.layout, layoutCommands);
}
