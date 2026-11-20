/**
 * ViscosityCode: where a new Cursor cloud agent starts.
 *
 * A cloud agent clones the project's `origin` on Cursor's VM, so it can only
 * see what has been pushed. The current branch must therefore track a branch
 * on `origin`; otherwise the launch is refused before any Cursor call rather
 * than silently starting from the default branch. Only Home threads start a
 * repo-less agent; any project folder without a pushed `origin` (including a
 * folder that is not a git work tree) is refused, since the agent could not
 * see the project.
 */
import type { ProjectLocation } from "@/shared/contracts";
import { parseForgeRemote } from "@/shared/forgeRemote";
import { isHomeScopeLocation } from "@/shared/homeScope";
import { msg } from "@/shared/messages";
import { execGit } from "../../git/exec";
import type { CursorSdkWorkerCloudOptions } from "./sdkWorkerProtocol";

const GIT_TIMEOUT_MS = 10_000;

export type CursorCloudLaunchResult =
  | { ok: true; repos: NonNullable<CursorSdkWorkerCloudOptions["repos"]> }
  | {
      ok: false;
      code: "no-upstream" | "unpushed" | "no-origin" | "unsupported-origin" | "git-unavailable";
      message: string;
    };

export type CursorCloudGit = (location: ProjectLocation, args: string[]) => Promise<string>;

const defaultGit: CursorCloudGit = (location, args) =>
  execGit(location, args, { timeout: GIT_TIMEOUT_MS, acceptedExitCodes: [1, 2, 128] });

/** `git@github.com:o/r.git`, `ssh://…`, `https://user@…/o/r` → `https://github.com/o/r`. */
export function cursorCloudRepoUrl(origin: string): string | undefined {
  const parsed = parseForgeRemote(origin.trim(), "origin");
  return parsed ? `${parsed.host}/${parsed.path}` : undefined;
}

export async function resolveCursorCloudLaunch(
  location: ProjectLocation,
  git: CursorCloudGit = defaultGit,
): Promise<CursorCloudLaunchResult> {
  // Home is a projectless session, even when ~ itself is a dotfiles repo.
  if (isHomeScopeLocation(location)) return { ok: true, repos: [] };
  try {
    const inside = (await git(location, ["rev-parse", "--is-inside-work-tree"])).trim();
    const origin =
      inside === "true" ? (await git(location, ["remote", "get-url", "origin"])).trim() : "";
    if (!origin) return { ok: false, code: "no-origin", message: msg("cursor.cloud.noOrigin") };
    const url = cursorCloudRepoUrl(origin);
    if (!url) {
      return {
        ok: false,
        code: "unsupported-origin",
        message: msg("cursor.cloud.unsupportedOrigin"),
      };
    }
    const branch = (await git(location, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const upstream = (
      await git(location, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    ).trim();
    const startingRef = upstream.startsWith("origin/") ? upstream.slice("origin/".length) : "";
    if (!branch || branch === "HEAD" || !startingRef) {
      return {
        ok: false,
        code: "no-upstream",
        message:
          branch && branch !== "HEAD"
            ? msg("cursor.cloud.pushBranch", { branch })
            : msg("cursor.cloud.checkoutBranch"),
      };
    }
    // The agent clones origin, so local commits it can't see would be silently missing.
    const ahead = Number.parseInt(
      (await git(location, ["rev-list", "--count", "@{u}..HEAD"])).trim(),
      10,
    );
    if (ahead > 0) {
      return {
        ok: false,
        code: "unpushed",
        message: msg("cursor.cloud.unpushedCommits", { branch }),
      };
    }
    return { ok: true, repos: [{ url, startingRef }] };
  } catch {
    return {
      ok: false,
      code: "git-unavailable",
      message: msg("cursor.cloud.gitUnavailable"),
    };
  }
}
