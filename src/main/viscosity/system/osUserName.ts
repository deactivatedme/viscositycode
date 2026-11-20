/**
 * ViscosityCode: the OS account's display name, the sidebar profile row's
 * default (Electron main only; the Tauri shell resolves it with the same rules
 * in `desktop-tauri/src/shell_script.rs`). Read once, never throws, and stays
 * on this device: it only becomes a renderer argument, never a log line.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";

export interface OsUserNameSources {
  platform: NodeJS.Platform;
  username: () => string;
  /** Runs a command and returns its stdout. */
  run: (file: string, args: readonly string[]) => string;
  readFile: (path: string) => string;
}

/** Full name where the OS has one, else the login name, else null. */
export function resolveOsUserName(sources: OsUserNameSources): string | null {
  let username = "";
  try {
    username = sources.username().trim();
  } catch {
    // userInfo can throw on locked-down systems.
  }
  let fullName = "";
  try {
    if (sources.platform === "darwin") {
      fullName = sources.run("/usr/bin/id", ["-F"]);
    } else if (sources.platform === "linux" && username) {
      const entry = sources
        .readFile("/etc/passwd")
        .split("\n")
        .find((line) => line.startsWith(`${username}:`));
      // GECOS: the full name is the first comma-separated field.
      fullName = entry?.split(":")[4]?.split(",")[0] ?? "";
    }
    // shortcut: Node has no cheap Windows display-name read, so this dev harness shows the
    // login name there; use the Tauri shell's secur32 lookup if Electron ships on Windows again.
  } catch {
    // Missing tool, timeout or unreadable file: the login name is the fallback.
  }
  const name = (fullName.trim() || username)
    .replace(/\p{Cc}/gu, "")
    .slice(0, 80)
    .trim();
  return name || null;
}

let cached: string | null | undefined;

/** Resolved on first use (a 500 ms cap on the macOS lookup), then reused for every window. */
export function osUserName(): string | null {
  if (cached === undefined) {
    cached = resolveOsUserName({
      platform: process.platform,
      username: () => userInfo().username,
      run: (file, args) =>
        execFileSync(file, args, {
          encoding: "utf8",
          timeout: 500,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      readFile: (path) => readFileSync(path, "utf8"),
    });
  }
  return cached;
}
