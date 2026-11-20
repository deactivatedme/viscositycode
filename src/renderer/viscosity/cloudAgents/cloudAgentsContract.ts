/**
 * ViscosityCode: the cloud agents host contract, as the Cloud tab reads it.
 *
 * The types are the shared contract (`src/shared/contracts/cloudAgents.ts`);
 * every value comes from the host through `cloudAgentsBridge()`, so the
 * renderer never calls a provider's API and never reads its key.
 */
import type {
  CloudAgentDetail,
  FollowCloudAgentPayload,
  FollowCloudAgentResult,
  GetCloudAgentPayload,
  ListCloudAgentsPayload,
  ListCloudAgentsResult,
} from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

export type {
  CloudAgentDetail,
  CloudAgentSourceListing,
  CloudAgentStatus,
  CloudAgentSummary,
  FollowCloudAgentResult,
  ListCloudAgentsResult,
} from "@/shared/contracts";

export interface CloudAgentsBridge {
  listCloudAgents(payload: ListCloudAgentsPayload): Promise<ListCloudAgentsResult>;
  getCloudAgent(payload: GetCloudAgentPayload): Promise<CloudAgentDetail>;
  followCloudAgent(payload: FollowCloudAgentPayload): Promise<FollowCloudAgentResult>;
}

/**
 * The host's cloud agent procedures, or `undefined` when this bridge does not
 * offer them (an older host, or a client without a bridge).
 */
export function cloudAgentsBridge(): CloudAgentsBridge | undefined {
  const bridge = readBridge() as Partial<CloudAgentsBridge> | undefined;
  return bridge && typeof bridge.listCloudAgents === "function"
    ? (bridge as CloudAgentsBridge)
    : undefined;
}
