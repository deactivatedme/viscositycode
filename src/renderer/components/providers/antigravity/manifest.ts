// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";
import { formatTaskNotificationMarkdown } from "./taskNotificationMarkdown";

export default {
  kind: "antigravity",
  label: msg`Antigravity`,
  order: 50,
  formatTranscriptMarkdown: formatTaskNotificationMarkdown,
  // ViscosityCode: plan suggestions for the Subscriptions editor (display only).
  subscriptionPlanNames: ["Free", "Pro", "Ultra"],
} satisfies RendererProviderManifest;
