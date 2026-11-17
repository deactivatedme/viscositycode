// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { forkIssuesUrl, forkRepositoryUrl } from "./viscosityRelease";

/**
 * Community destinations shared by About, Feedback, Changelog, and the news line.
 *
 * ViscosityCode: repository, release, and issue links point at the fork's own
 * GitHub repository (`FORK_GITHUB_REPOSITORY` in `viscosityRelease.ts`) and are
 * `undefined` — so their UI hides — until it exists. Nothing links to
 * Poracode's community; the upstream destinations below stay only because the
 * persisted promotion ids map to them.
 */
export function communityRepositoryUrl(): string | undefined {
  return forkRepositoryUrl();
}

export function communityIssuesUrl(): string | undefined {
  return forkIssuesUrl();
}

export function communityReleasesUrl(): string | undefined {
  const repository = forkRepositoryUrl();
  return repository ? `${repository}/releases` : undefined;
}

export function communityLicenseUrl(): string | undefined {
  const repository = forkRepositoryUrl();
  return repository ? `${repository}/blob/HEAD/LICENSE` : undefined;
}

/** Upstream Poracode community destinations (promotion targets only; never shown by the fork). */
export const PORACODE_REPO_URL = "https://github.com/Porabuild/Poracode";
export const PORACODE_X_URL = "https://x.com/poracode";
export const CREATOR_X_URL = "https://x.com/serg_vecher";

/**
 * Community promotions. Each id is persisted in shared settings
 * (`dismissedPromotions`) once the user opens or closes it, which hides it on
 * every surface. Never reuse or rename an id: older hosts may still hold it.
 */
export const COMMUNITY_PROMOTION_IDS = ["github-star", "x-poracode", "x-creator"] as const;
export type CommunityPromotionId = (typeof COMMUNITY_PROMOTION_IDS)[number];

export const COMMUNITY_PROMOTION_URLS: Record<CommunityPromotionId, string> = {
  "github-star": PORACODE_REPO_URL,
  "x-poracode": PORACODE_X_URL,
  "x-creator": CREATOR_X_URL,
};

/**
 * ViscosityCode: the promotions the news line may show. Every upstream one
 * promotes Poracode (star its repository, follow it or its creator on X), so
 * the fork shows none. The ids above stay reserved for persisted settings.
 */
export function activeCommunityPromotionIds(): readonly CommunityPromotionId[] {
  return [];
}
