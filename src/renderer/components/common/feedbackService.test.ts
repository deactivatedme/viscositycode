import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_SERVICE_URL, feedbackDestination } from "./feedbackService";

const links = vi.hoisted(() => ({ issuesUrl: undefined as string | undefined }));

vi.mock("@/shared/communityLinks", () => ({
  communityIssuesUrl: () => links.issuesUrl,
}));

describe("feedbackDestination", () => {
  beforeEach(() => {
    links.issuesUrl = undefined;
  });

  it("has no hosted feedback service by default", () => {
    expect(FEEDBACK_SERVICE_URL).toBeNull();
  });

  it("hides feedback when the fork has no issue tracker yet", () => {
    expect(feedbackDestination()).toBeNull();
  });

  it("opens the fork's issue tracker once the fork has a repository", () => {
    links.issuesUrl = "https://github.com/owner/viscositycode/issues";
    expect(feedbackDestination()).toEqual({
      kind: "external",
      url: "https://github.com/owner/viscositycode/issues",
    });
  });
});
