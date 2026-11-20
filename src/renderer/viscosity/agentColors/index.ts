/**
 * ViscosityCode per-agent accent colours: feature entry.
 *
 * Importing this module installs the marker styles and the generated
 * per-agent stylesheet once per window (both inert outside the desktop shell
 * apart from defining `--vc-agent-accent`). It is imported for that side
 * effect from the desktop center frame (layout/tabs/ViscosityCenterFrame.tsx),
 * which loads with the main layout. Other features never import it: they use the
 * contract in `./api` and pick the colours up through CSS. The settings block
 * lives in `./AgentColorsSettings`.
 */
import "./agentColors.css";
import { ensureAgentColorsInstalled } from "./runtime";

const uninstall = ensureAgentColorsInstalled();
if (uninstall) import.meta.hot?.dispose(uninstall);
