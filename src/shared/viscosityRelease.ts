/**
 * ViscosityCode release and community configuration (fork of Poracode).
 *
 * The fork never calls Poracode's servers. Features that need a home on the
 * internet (update feed, issue tracker, release downloads) stay switched off
 * until the fork owner fills these in — typically after creating the fork's own
 * GitHub repository (`git remote add origin …`). Packaging scripts read the
 * matching environment variables documented in BUILDING.md.
 */

/** GitHub repository that hosts ViscosityCode releases, as "owner/repo". Empty = none yet. */
export const FORK_GITHUB_REPOSITORY = "";

/** Upstream project this fork is based on (attribution only; never contacted at runtime). */
export const UPSTREAM_REPOSITORY_URL = "https://github.com/Porabuild/Poracode";

export function forkRepositoryUrl(): string | undefined {
  return FORK_GITHUB_REPOSITORY ? `https://github.com/${FORK_GITHUB_REPOSITORY}` : undefined;
}

export function forkIssuesUrl(): string | undefined {
  const repo = forkRepositoryUrl();
  return repo ? `${repo}/issues` : undefined;
}
