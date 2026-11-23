import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { isExecutableRegularFile } from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";

/** Devin Desktop includes the same CLI under its Windsurf extension on macOS. */
export function resolveDevinDesktopBinary(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  const relativePath = "Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
  return ["/Applications", join(homedir(), "Applications")]
    .map((directory) => join(directory, relativePath))
    .find(isExecutableRegularFile);
}

export function resolveDevinBinaryPath(location: ProjectLocation): string | undefined {
  return (
    resolveAgentBinaryPath(location, "devin") ??
    (location.kind === "posix" ? resolveDevinDesktopBinary() : undefined)
  );
}
