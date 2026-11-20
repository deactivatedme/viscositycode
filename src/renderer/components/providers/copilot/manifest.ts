// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "copilot",
  label: msg`GitHub Copilot`,
  order: 90,
  // ViscosityCode: plan suggestions for the Subscriptions editor (display only).
  subscriptionPlanNames: ["Free", "Pro", "Pro+", "Business", "Enterprise"],
} satisfies RendererProviderManifest;
