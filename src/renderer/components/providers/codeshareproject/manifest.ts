import { msg } from "@lingui/core/macro";
import { CODE_SHARE_PROJECT_AGENT } from "@/shared/codeShareProjectAccess";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: CODE_SHARE_PROJECT_AGENT,
  label: msg`CodeShare`,
  order: 1100,
  manualSelectionOnly: true,
} satisfies RendererProviderManifest;
