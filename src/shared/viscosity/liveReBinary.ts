/**
 * ViscosityCode: finds the staged `viscosity-live-re` binary. Node-only (used
 * by the supervisor and Electron main, never the renderer). Same lookup as
 * `nativeGitHelperBinaryPath`: explicit override, the helpers dir main
 * exports, then the repo's resources for direct dev and test runs.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_RE_BINARY_NAME } from "./liveRe";

/** Explicit binary path; wins over every other location. */
export const LIVE_RE_BIN_ENV = "VISCOSITY_LIVE_RE_BIN";

export type LiveReTargetId = "darwin-universal" | "win32-x64" | "win32-arm64";

/** Hosts the helper ships for; Linux (and so WSL and SSH hosts) has none. */
export function liveReTargetId(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): LiveReTargetId | undefined {
  if (platform === "darwin") return "darwin-universal";
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) return `win32-${arch}`;
  return undefined;
}

export interface LiveReBinaryLookup {
  /** Resources `wsl-helpers` dir; defaults to the env main exports. */
  helpersDir?: string | undefined;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
}

function repoHelperRoots(): string[] {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // Source (src/shared/viscosity) and bundled (dist/main) layouts.
    return [
      resolve(moduleDir, "../../../resources/wsl-helpers"),
      resolve(moduleDir, "../../resources/wsl-helpers"),
    ];
  } catch {
    return [];
  }
}

/** Candidate paths in lookup order (the override alone when it is set). */
export function liveReBinaryCandidates(lookup: LiveReBinaryLookup = {}): string[] {
  const env = lookup.env ?? process.env;
  const override = env[LIVE_RE_BIN_ENV]?.trim();
  if (override) return [override];
  const platform = lookup.platform ?? process.platform;
  const id = liveReTargetId(platform, lookup.arch ?? process.arch);
  if (!id) return [];
  const exe = platform === "win32" ? `${LIVE_RE_BINARY_NAME}.exe` : LIVE_RE_BINARY_NAME;
  const helpersDir =
    lookup.helpersDir ?? env.PORACODE_WSL_HELPERS_DIR ?? env.PORACODE_WSL_WATCHER_DIR;
  const roots = [...(helpersDir ? [helpersDir] : []), ...repoHelperRoots()];
  return [...new Set(roots)].map((root) => join(root, "live-re", id, exe));
}

/** The staged binary for this host, or undefined (never throws). */
export function liveReBinaryPath(lookup: LiveReBinaryLookup = {}): string | undefined {
  return liveReBinaryCandidates(lookup).find((candidate) => existsSync(candidate));
}
