/**
 * ViscosityCode fork commands entry (fork of Poracode).
 *
 * Upstream's command registry imports this module once, which registers the
 * fork's built-in palette commands; it then spreads `viscosityCommands()`.
 * Features register their own commands with `registerViscosityCommands`.
 */
import { registerBuiltinViscosityCommands } from "./registerBuiltinCommands";

registerBuiltinViscosityCommands();

export { registerViscosityCommands, viscosityCommands } from "./viscosityCommands";
export { VISCOSITY_COMMAND_IDS, type ViscosityCommandId } from "./commandIds";
