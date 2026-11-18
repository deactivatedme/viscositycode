/**
 * ViscosityCode: Smart start display names (fork of Poracode).
 *
 * Pure helpers that name a pick the way the composer shows it:
 * "<provider> · <account> · <model> — 72% left". A base kind is the provider's default
 * account and is named by the provider alone; a profile account adds its own
 * name. Nothing here knows a provider by name.
 */
import { baseAgentKind, type AgentInstanceConfigMap } from "@/shared/contracts";

/** The account part of a pick's name, or undefined for a provider's default account. */
export function smartStartAccountName(
  agentKind: string,
  instances: AgentInstanceConfigMap | undefined,
): string | undefined {
  const driver = baseAgentKind(agentKind);
  if (driver === agentKind) return undefined;
  const instanceId = agentKind.slice(driver.length + 1);
  if (!instanceId) return undefined;
  const instance =
    instances && Object.hasOwn(instances, instanceId) ? instances[instanceId] : undefined;
  const name = instance?.displayName?.trim();
  return name || instanceId;
}

/** "Provider · Account · Model", skipping the parts that are unknown or repeat the provider. */
export function smartStartPickName(parts: {
  providerLabel: string;
  accountName?: string | undefined;
  modelLabel?: string | undefined;
}): string {
  const names = [parts.providerLabel];
  if (parts.accountName && parts.accountName !== parts.providerLabel) names.push(parts.accountName);
  if (parts.modelLabel) names.push(parts.modelLabel);
  return names.join(" · ");
}
