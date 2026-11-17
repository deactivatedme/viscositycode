// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { existsSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BRAND_NAME } from "@/shared/brand";
import { resolvePoracodeBaseDir } from "@/shared/poracodePaths";
import { FORK_GITHUB_REPOSITORY } from "@/shared/viscosityRelease";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { readStandaloneRuntimeMarker } from "../../scripts/server-release-install.mjs";
import { defaultCliInstallPrefix } from "../../packages/poracode-cli/lib/installPaths.mjs";
import { resolveTuiCacheRoot } from "./cliTuiDownload";
import { probeRunningOwner } from "./serverUpgradeIdentity";

/**
 * The installer-managed prefix: `<prefix>/releases/<version>` self-contained
 * archives with `current` pointing at the active one, plus the shared pieces
 * every lifecycle command (`update`, `uninstall`, `up`) needs to stay inside
 * it — prefix resolution, the running-owner probe, and TUI cache cleanup.
 */
// ViscosityCode: CLI releases come only from the fork's own GitHub repository
// ("owner/repo" in src/shared/viscosityRelease.ts), never from upstream
// Poracode. Empty means this build has no release feed.
export const RELEASE_REPOSITORY: string = FORK_GITHUB_REPOSITORY;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export class SelfUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfUpdateError";
  }
}

/**
 * The release repository for CLI self-update and release downloads. Refuses
 * before any network request when this build has none configured.
 */
export function requireReleaseRepository(repository: string = RELEASE_REPOSITORY): string {
  const trimmed = repository.trim();
  if (!trimmed) {
    throw new SelfUpdateError(
      `This ${BRAND_NAME} build has no release repository configured, so it cannot check ` +
        "for or download CLI releases. Install a newer build with what installed this one, " +
        "or upgrade from a local archive with --from <tarball>.",
    );
  }
  return trimmed;
}

export interface InstallerPrefix {
  readonly prefix: string;
  readonly currentDir: string;
  readonly currentVersion: string;
}

/**
 * The installer-managed prefix: an explicit `--prefix`, or the one holding the
 * running release (`<prefix>/releases/<id>` beside `<prefix>/current`).
 */
export function resolveInstallerPrefix(input: {
  readonly explicitPrefix?: string;
  readonly releaseRoot: string;
}): InstallerPrefix {
  let prefix: string;
  if (input.explicitPrefix !== undefined) {
    prefix = resolve(input.explicitPrefix);
  } else {
    const releaseRoot = realpathSync(input.releaseRoot);
    const releases = dirname(releaseRoot);
    if (
      readStandaloneRuntimeMarker(releaseRoot) === null ||
      basename(releases) !== "releases" ||
      !existsSync(join(dirname(releases), "current"))
    ) {
      throw new SelfUpdateError(
        "This CLI was not installed by the one-line installer. Update it with what " +
          "installed it (for example the desktop app's updater or your package manager), " +
          "or pass --prefix for a one-line-installer prefix.",
      );
    }
    prefix = dirname(releases);
  }
  const current = join(prefix, "current");
  if (!existsSync(current)) {
    throw new SelfUpdateError(
      `${prefix} has no current release link; it is not an installed prefix.`,
    );
  }
  const currentDir = realpathSync(current);
  const marker = readStandaloneRuntimeMarker(currentDir);
  if (marker === null) {
    throw new SelfUpdateError(
      `${currentDir} is not a self-contained release; upgrade it with poracode upgrade --from <tarball>.`,
    );
  }
  return { prefix, currentDir, currentVersion: marker.version };
}

/**
 * The one-line installer's default prefix, matching install.sh/install.ps1:
 * PORACODE_INSTALL_DIR wins, then %LOCALAPPDATA%\Poracode\server on Windows or
 * ~/.local/share/poracode/server elsewhere.
 */
export function defaultInstallerPrefix(
  input: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly home?: string;
  } = {},
): string {
  return defaultCliInstallPrefix(input);
}

export function defaultProbeOwner() {
  const baseDir = process.env.PORACODE_BASE_DIR?.trim() || resolvePoracodeBaseDir();
  return probeRunningOwner(resolveHostRootPaths(baseDir));
}

/**
 * Remove `<cache>/poracode/tui/<version>` entries for the given app versions.
 * Only VERSION_PATTERN-shaped versions are touched, so a malformed marker can
 * never resolve outside the cache root; busy entries stay.
 */
export function removeTuiCachesForVersions(
  versions: Iterable<string>,
  deps: {
    readonly env: NodeJS.ProcessEnv;
    readonly platform: NodeJS.Platform;
    readonly home: string;
  },
): string[] {
  const cacheRoot = resolveTuiCacheRoot(deps.env, deps.platform, deps.home);
  const removed: string[] = [];
  for (const version of [...new Set(versions)].sort()) {
    if (!VERSION_PATTERN.test(version)) continue;
    const cache = join(cacheRoot, version);
    try {
      if (!existsSync(cache)) continue;
      rmSync(cache, { recursive: true, force: true });
      removed.push(cache);
    } catch {
      // A busy cache entry stays; verified content is safe to keep.
    }
  }
  return removed;
}
