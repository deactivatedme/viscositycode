/**
 * ViscosityCode: registers Zen mode's palette command once per renderer (fork
 * of Poracode). Idempotent.
 */
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { zenCommands } from "./zenCommands";

export const ZEN_COMMANDS_KEY = "zen";

let registered = false;

export function registerZenMode(): void {
  if (registered) return;
  registered = true;
  registerViscosityCommands(ZEN_COMMANDS_KEY, zenCommands);
}
