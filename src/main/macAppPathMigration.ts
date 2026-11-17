// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { PoracodeChannel } from "@/shared/channel";

interface MacAppPathMigrationOptions {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  executablePath?: string;
}

type MacAppPathMigrationResult = "created" | "skipped" | "failed";

/**
 * Upstream restored the pre-rebrand `Lightcode.app` path as a relative symlink
 * after Squirrel renamed the installed bundle, so old macOS Dock tiles kept
 * working.
 *
 * ViscosityCode: the fork has no Lightcode or Poracode installs to bridge, so
 * this is a documented no-op that never touches the filesystem. The export and
 * signature stay so the desktop and attach-mode startup paths compile
 * unchanged.
 */
export function repairLegacyMacAppPath(
  _channel: PoracodeChannel,
  _options: MacAppPathMigrationOptions = {},
): MacAppPathMigrationResult {
  return "skipped";
}
