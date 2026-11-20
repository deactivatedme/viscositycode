/**
 * ViscosityCode: cloud agents a provider runs on its own infrastructure. The
 * supervisor reads them with the profile's own key, which never leaves the
 * host. Desktop shell only in v1 (local-shell, not in the remote allowlist):
 * followed agents become ordinary threads that sync to every client.
 */
import {
  followCloudAgentPayloadSchema,
  getCloudAgentPayloadSchema,
  listCloudAgentsPayloadSchema,
  type CloudAgentDetail,
  type FollowCloudAgentPayload,
  type FollowCloudAgentResult,
  type GetCloudAgentPayload,
  type ListCloudAgentsPayload,
  type ListCloudAgentsResult,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

export const cloudAgentProcedures = {
  /** Cached per source for 30 s; `refresh` skips the TTL, never the backoff. */
  listCloudAgents: definePayloadProcedure<
    ListCloudAgentsPayload,
    ListCloudAgentsResult,
    "supervisor"
  >("listCloudAgents", "supervisor", listCloudAgentsPayloadSchema),
  getCloudAgent: definePayloadProcedure<GetCloudAgentPayload, CloudAgentDetail, "supervisor">(
    "getCloudAgent",
    "supervisor",
    getCloudAgentPayloadSchema,
  ),
  /** Replays the agent into a thread the client already created, then records its resume ref. */
  followCloudAgent: definePayloadProcedure<
    FollowCloudAgentPayload,
    FollowCloudAgentResult,
    "supervisor"
  >("followCloudAgent", "supervisor", followCloudAgentPayloadSchema),
} as const;
