import { communityIssuesUrl } from "@/shared/communityLinks";

/**
 * ViscosityCode: where in-app feedback goes.
 *
 * Upstream posts the feedback form to Poracode's website, which files a GitHub
 * issue on Poracode's repository. The fork never contacts Poracode, so the
 * hosted feedback service is off: the form makes no request unless a fork
 * owner sets this to a service they run (same API as upstream).
 */
export const FEEDBACK_SERVICE_URL: string | null = null;

export type FeedbackDestination = { kind: "dialog" } | { kind: "external"; url: string };

/**
 * What the "Send feedback" entry does: open the in-app form when a feedback
 * service exists, otherwise open the fork's issue tracker in the browser, or —
 * with neither configured — nothing, and the entry is hidden.
 */
export function feedbackDestination(): FeedbackDestination | null {
  if (FEEDBACK_SERVICE_URL) return { kind: "dialog" };
  const issuesUrl = communityIssuesUrl();
  return issuesUrl ? { kind: "external", url: issuesUrl } : null;
}
