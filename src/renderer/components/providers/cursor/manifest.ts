// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "cursor",
  label: msg`Cursor`,
  order: 80,
  // ViscosityCode: plan suggestions for the Subscriptions editor (display only).
  subscriptionPlanNames: ["Hobby", "Pro", "Pro+", "Ultra", "Teams"],
} satisfies RendererProviderManifest;
