/**
 * ViscosityCode: shared usage-account resolution (fork of Poracode).
 *
 * Maps the agent kind a thread runs on (`<driver>`, `<driver>:work`, …) to the id of
 * the usage snapshot that meters that account. It used to live only in the
 * renderer (`usageProviderIdForAgent` in
 * src/renderer/components/providers/usageProviders.ts, which now delegates
 * here); host-owned policy such as account-pool failover needs the same
 * answer without a renderer.
 *
 * Resolution never falls back to a different profile's account: a profile
 * whose quota owner is unavailable keeps its own id, so no caller can show or
 * act on another login's quota by accident.
 */
import {
  baseAgentKind,
  type AgentInstanceConfig,
  type AgentInstanceConfigMap,
} from "./contracts/agentInstance";
import { agentProfileKind } from "./contracts/agentProfiles";
import { devinUsageAccountSupport } from "./agents/devin/usageAccountSupport";

/**
 * Provider-declared quota owner for one profile instance. Undefined means the
 * owner is unavailable, never permission to use another account's quota; the
 * caller then keeps the profile's own id.
 */
export type ProfileUsageAccountResolver = (
  instance: AgentInstanceConfig,
  instances: AgentInstanceConfigMap,
) => string | undefined;

/**
 * Capability a profile driver declares in its provider folder when several of
 * its profiles can share one meter (for example configuration profiles that
 * reference one login owner). Drivers without one meter each profile under
 * its own `<driver>:<id>` kind.
 */
export interface ProfileUsageAccountSupport {
  /** `AgentInstanceConfig.driver` of the profiles this resolver owns. */
  driver: string;
  usageAccountId: ProfileUsageAccountResolver;
}

/** Explicit registrations; each value is declared in its provider folder. */
const PROFILE_USAGE_ACCOUNT_SUPPORT: readonly ProfileUsageAccountSupport[] = [
  devinUsageAccountSupport,
];

const RESOLVERS = new Map(
  PROFILE_USAGE_ACCOUNT_SUPPORT.map((entry) => [entry.driver, entry.usageAccountId] as const),
);

/** The shared quota-owner resolver a profile driver declared, if any. */
export function profileUsageAccountResolver(
  driver: string,
): ProfileUsageAccountResolver | undefined {
  return RESOLVERS.get(driver);
}

/** Client- or host-specific lookups layered over the shared defaults. */
export interface UsageAccountIdHooks {
  /**
   * Usage id a base (non-profile) agent kind reports under when it differs
   * from the kind itself (a provider manifest's `usageProviderId`). Without
   * it a base kind meters under its own id, which holds for every profile
   * driver.
   */
  baseUsageProviderId?: (driver: string) => string | undefined;
  /** Replaces the shared registry of profile quota owners. */
  profileUsageAccountId?: (driver: string) => ProfileUsageAccountResolver | undefined;
}

/**
 * Usage snapshot id for `agentKind`. `instanceId` overrides the profile id
 * carried in the kind's suffix; `instances` is the host's
 * `sharedSettings.agentInstances`, needed only for drivers whose profiles can
 * share a meter.
 */
export function usageAccountIdForAgent(
  agentKind: string,
  instanceId: string | undefined,
  instances: AgentInstanceConfigMap | undefined,
  hooks: UsageAccountIdHooks = {},
): string {
  const driver = baseAgentKind(agentKind);
  const id = instanceId ?? (driver !== agentKind ? agentKind.slice(driver.length + 1) : undefined);
  if (!id) return hooks.baseUsageProviderId?.(driver) ?? agentKind;
  const candidate = agentProfileKind(driver, id);
  const instance = instances && Object.hasOwn(instances, id) ? instances[id] : undefined;
  const resolve = (hooks.profileUsageAccountId ?? profileUsageAccountResolver)(driver);
  if (!instances || !instance || instance.driver !== driver || !resolve) return candidate;
  return resolve(instance, instances) ?? candidate;
}

/** A retained usage snapshot cannot override an explicit agent opt-out. */
export function isUsageAgentEnabled(
  usageId: string,
  disabledAgents: readonly string[],
  instances: AgentInstanceConfigMap | undefined,
): boolean {
  if (disabledAgents.includes(usageId)) return false;
  const driver = baseAgentKind(usageId);
  if (driver === usageId) return true;
  const id = usageId.slice(driver.length + 1);
  const instance = instances && Object.hasOwn(instances, id) ? instances[id] : undefined;
  return instance?.driver !== driver || instance.enabled !== false;
}
