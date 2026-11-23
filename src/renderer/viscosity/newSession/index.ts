/**
 * ViscosityCode: the desktop shell's New session view (fork of Poracode).
 *
 * - `NewSessionLanding`: replaces HomeView in the shell; `home` redirects to a
 *   draft in the most recently used project.
 * - `NewSessionCenter`: the centre slot of the top-level draft (folder picker,
 *   device menu).
 */
import "./newSession.css";

export { NewSessionLanding } from "./NewSessionLanding";
export { NewSessionCenter } from "./NewSessionCenter";
export { resolveNewSessionProjectId } from "./resolveNewSessionProjectId";
