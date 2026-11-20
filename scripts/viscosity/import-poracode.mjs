#!/usr/bin/env node
/**
 * One-time import of Poracode chats and projects into ViscosityCode.
 *
 *   node scripts/viscosity/import-poracode.mjs [--apply] [--from ~/.poracode] [--to ~/.viscositycode]
 *
 * Quit both apps first. Without --apply it only prints what it would import.
 * --to takes the profile namespace (~/.viscositycode-dev for the dev app).
 * On Windows, ~\.poracode and %USERPROFILE%\.poracode work too.
 * Runs from a source checkout after `bun install`; the installed app does not include it.
 * Logic and tests: src/host/viscosity/poracodeImport/.
 */
import { register } from "node:module";

register("../remote-v3-ts-loader.mjs", import.meta.url);
const { main } = await import("../../src/host/viscosity/poracodeImport/cli.ts");
process.exitCode = await main(process.argv.slice(2));
