import { describe, expect, it } from "vitest";
import {
  activeCommunityPromotionIds,
  communityIssuesUrl,
  communityLicenseUrl,
  communityReleasesUrl,
  communityRepositoryUrl,
} from "./communityLinks";
import { forkIssuesUrl, forkRepositoryUrl } from "./viscosityRelease";

describe("community links (ViscosityCode)", () => {
  it("follows the fork's own repository, never Poracode's", () => {
    const repository = forkRepositoryUrl();
    expect(communityRepositoryUrl()).toBe(repository);
    expect(communityIssuesUrl()).toBe(forkIssuesUrl());
    expect(communityReleasesUrl()).toBe(repository ? `${repository}/releases` : undefined);
    expect(communityLicenseUrl()).toBe(repository ? `${repository}/blob/HEAD/LICENSE` : undefined);
    for (const url of [
      communityRepositoryUrl(),
      communityIssuesUrl(),
      communityReleasesUrl(),
      communityLicenseUrl(),
    ]) {
      expect(url ?? "").not.toMatch(/github\.com\/porabuild\//i);
    }
  });

  it("shows no upstream community promotions", () => {
    expect(activeCommunityPromotionIds()).toEqual([]);
  });
});
