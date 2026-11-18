/**
 * ViscosityCode: account pools in the draft composer (fork of Poracode).
 *
 * When the provider a new thread would start on has an enabled pool, the
 * draft pre-selects the pooled account with the most usage left and shows
 * "Account: <name> — most usage left" next to the model picker. The owner can
 * still pick any other account in the picker; the chip then just names it.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { UsersRound } from "lucide-react";
import type { AgentStatus, UsageSnapshot } from "@/shared/contracts";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAccountLabelResolver } from "./poolHooks";
import { activePoolFor, poolPreferredAgentKind } from "./poolModel";
import { useAccountPools } from "./poolSettings";

const NO_SNAPSHOTS: Readonly<Record<string, UsageSnapshot>> = {};

export interface AccountPoolDraftSelection {
  /** The account the draft should start on (the composer's own pick when not pooled). */
  agentKind: string | undefined;
  /** The chip shown next to the model picker for `selectedKind`, when it is pooled. */
  controlFor: (selectedKind: string | undefined) => ComposerControl | undefined;
}

/**
 * Resolve the draft's starting account. `enabled` is false where pools do not
 * apply: isolated selections (a side chat follows its thread) and projects on
 * a paired host (that host keeps its own pools).
 */
export function useAccountPoolDraftSelection(input: {
  preferred: string | undefined;
  /** Accounts the composer can start (installed, enabled, matching presentation). */
  candidates: readonly AgentStatus[];
  enabled: boolean;
}): AccountPoolDraftSelection {
  const { t } = useLingui();
  const pools = useAccountPools();
  const instances = useSharedSettings((state) => state.agentInstances);
  // Without an enabled pool the composer never needs usage, so it does not
  // re-render on usage pushes at all.
  const watchUsage = input.enabled && Object.values(pools).some((pool) => pool.enabled);
  const snapshots = useProviderUsageStore((state) => (watchUsage ? state.snapshots : NO_SNAPSHOTS));
  const labelFor = useAccountLabelResolver();
  // A draft is short-lived: judge usage as of when it opened, so the heavy
  // composer never re-renders on a clock (usage pushes still update it).
  const [now] = useState(() => Date.now());

  const resolveFor = (kind: string | undefined) =>
    poolPreferredAgentKind({
      preferred: kind,
      candidates: input.candidates,
      pools,
      instances,
      snapshots,
      now,
    });

  const resolved = input.enabled
    ? resolveFor(input.preferred)
    : { agentKind: input.preferred, pooled: false };

  return {
    agentKind: resolved.agentKind,
    controlFor: (selectedKind) => {
      if (!input.enabled || !selectedKind) return undefined;
      if (!activePoolFor(selectedKind, pools, instances)) return undefined;
      const best = resolveFor(selectedKind);
      const label = labelFor(selectedKind);
      const value =
        best.pooled && best.agentKind === selectedKind
          ? t`Account: ${label} — most usage left`
          : t`Account: ${label}`;
      return {
        kind: "static",
        value,
        icon: <UsersRound aria-hidden="true" className="size-3.5 shrink-0" />,
        hideLabelOnWrap: true,
        tier: 1,
      };
    },
  };
}

/** `controls` with the account chip placed right after the model picker (or first). */
export function withAccountPoolControl(
  controls: ComposerControl[],
  chip: ComposerControl | undefined,
): ComposerControl[] {
  if (!chip) return controls;
  const pickerIndex = controls.findIndex((control) => control.kind === "provider-model");
  const next = [...controls];
  next.splice(pickerIndex + 1, 0, chip);
  return next;
}
