import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import {
  getPrimedPosixEnv,
  getWindowsPathOverrideEnv,
  readAgentCommandOutput,
  resolveExecutablePathAsync,
} from "../base";

const CLAUDE_CODE_VERSION = /^(\d+)\.\d+\.\d+\s+\(Claude Code\)/u;

function installedFile(path: string): string | undefined {
  try {
    if (!isAbsolute(path)) return undefined;
    const real = realpathSync(path);
    const mode = statSync(real);
    return mode.isFile() && (process.platform === "win32" || (mode.mode & 0o111) !== 0)
      ? real
      : undefined;
  } catch {
    return undefined;
  }
}

async function claudeCodeMajor(
  location: ProjectLocation,
  path: string,
  signal: AbortSignal | undefined,
): Promise<number | undefined> {
  signal?.throwIfAborted();
  const result = await readAgentCommandOutput(location, path, ["--version"], {
    timeoutMs: 2_000,
    ...(signal ? { signal } : {}),
  });
  signal?.throwIfAborted();
  const version = result.ok ? CLAUDE_CODE_VERSION.exec(result.stdout.trim())?.[1] : undefined;
  return version === undefined ? undefined : Number(version);
}

/** Select the first current Claude Code install when an old 1.x binary shadows it. */
export async function findCompatibleClaudeOverride(
  location: ProjectLocation,
  signal?: AbortSignal,
  resolved?: string | null,
): Promise<string | undefined> {
  if (location.kind === "wsl") return undefined;
  const primary = resolved === undefined ? await resolveExecutablePathAsync("claude") : resolved;
  const primaryFile = primary && installedFile(primary);
  if (!primaryFile) return undefined;

  // Read candidate versions from home, never from a project-controlled cwd.
  const home = homedir();
  const nativeLocation = { ...location, path: home };
  const env = location.kind === "windows" ? getWindowsPathOverrideEnv() : getPrimedPosixEnv();
  const searchPath = env?.PATH ?? env?.Path ?? process.env.PATH ?? "";
  const directories = [
    ...searchPath.split(delimiter),
    join(home, ".local", "bin"),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
  ];
  const names = location.kind === "windows" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const seen = new Set([primaryFile]);
  const alternatives = [];
  for (const directory of new Set(directories.map((value) => value.replace(/^"|"$/gu, "")))) {
    if (!isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      const file = installedFile(candidate);
      if (file && !seen.has(file)) {
        seen.add(file);
        alternatives.push(candidate);
      }
    }
  }
  if (alternatives.length === 0) return undefined;
  if ((await claudeCodeMajor(nativeLocation, primary, signal)) !== 1) return undefined;
  for (const candidate of alternatives) {
    if (((await claudeCodeMajor(nativeLocation, candidate, signal)) ?? 0) >= 2) return candidate;
  }
  return undefined;
}
