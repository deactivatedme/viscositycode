/**
 * ViscosityCode: "Let ViscosityCode pick" in the new-thread composer (fork of Poracode).
 *
 * The composer gets an "Auto" toggle next to its model picker (remembered per
 * project). While Auto is on, the draft starts on the ready account with the
 * most usage left, nudged by the owner's preference list for what the prompt
 * looks like; a dock row names the pick before sending and offers a one-pick
 * override. The pick drives the draft's own selection (the provider's saved
 * default model follows), so Send uses the composer's normal launch path.
 * With nothing to pick from, the row says so and the manual picker applies.
 *
 * Desktop shell only, local projects only, never for isolated selections
 * (a side chat follows its thread).
 */
import { useEffect, useState, type ReactNode } from "react";
import { msg } from "@lingui/core/macro";
import { Sparkles } from "lucide-react";
import type {
  AgentStatus,
  ProjectDraftConfig,
  ProviderDraftConfig,
  ThreadPresentationMode,
  UsageSnapshot,
} from "@/shared/contracts";
import { getProviderModelPickerRank } from "@/renderer/components/providers/providerManifest";
import { usageProviderIdForAgent } from "@/renderer/components/providers/usageProviders";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAccountPools } from "@/renderer/viscosity/accountPools/poolSettings";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import {
  buildSmartStartCandidates,
  describeSmartStartAccount,
  type SmartStartCandidateInput,
} from "./candidates";
import { useDraftTaskKind } from "./draftTaskKind";
import {
  decideSmartStart,
  resolvePreferenceOrder,
  smartStartProviderOf,
  type SmartStartDecision,
} from "./scoring";
import { SmartStartPanel } from "./SmartStartPanel";
import { useLastUsedProviderOrder } from "./lastUsed";
import { selectAutoForProject, useSmartStartStore } from "./smartStartStore";

const NO_SNAPSHOTS: Readonly<Record<string, UsageSnapshot>> = {};
const NO_PROVIDER_CONFIGS: Record<string, ProviderDraftConfig> = {};

type ProviderModelControl = Extract<ComposerControl, { kind: "provider-model" }>;

/** Stable English identity of the Auto toggle control (never localized). */
export const SMART_START_CONTROL_LABEL = "Auto";

export interface SmartStartDraftInput {
  projectId: string;
  /** False for isolated selections and projects on a paired host. */
  enabled: boolean;
  /** The Home scope starts providers from their defaults, not their saved configs. */
  homeScope?: boolean;
  agents: readonly AgentStatus[];
  disabledAgents: readonly string[];
  presentationMode: ThreadPresentationMode;
  lastDraftConfig: ProjectDraftConfig | undefined;
  /** The draft's current account. */
  currentAgentKind: string | undefined;
  /** Switch the draft to an account; its saved default model follows. */
  selectAgent: (agentKind: string) => void;
}

export interface SmartStartDraft {
  /** Auto is on for this draft. */
  active: boolean;
  /** `controls` with the Auto toggle before the model picker; picker choices become overrides. */
  decorateControls: (controls: ComposerControl[]) => ComposerControl[];
  /** The dock row naming the pick, or null while Auto is off. */
  panel: ReactNode;
  /** `onStart` that remembers hand-picked providers (the default preference order). */
  wrapStart: <T extends { agentKind: string }, R>(onStart: (input: T) => R) => (input: T) => R;
}

/**
 * `controls` with `toggle` placed right before the model picker (or first),
 * and the picker's choices reported through `onPickerChoice` first.
 */
export function withSmartStartControls(
  controls: readonly ComposerControl[],
  toggle: ComposerControl,
  onPickerChoice: ((agentKind: string) => void) | undefined,
): ComposerControl[] {
  const next = controls.map((control): ComposerControl => {
    if (control.kind !== "provider-model" || !onPickerChoice) return control;
    const { onChange } = control;
    const picker: ProviderModelControl = {
      ...control,
      onChange: (selection) => {
        onPickerChoice(selection.agentKind);
        onChange(selection);
      },
    };
    return picker;
  });
  const pickerIndex = next.findIndex((control) => control.kind === "provider-model");
  next.splice(Math.max(0, pickerIndex), 0, toggle);
  return next;
}

export function useSmartStartDraft(input: SmartStartDraftInput): SmartStartDraft {
  const shell = useViscosityShellEnabled();
  const available = input.enabled && shell;
  const autoOn = useSmartStartStore(selectAutoForProject(input.projectId)) && available;
  const setAuto = useSmartStartStore((state) => state.setAuto);
  const recordProviderUse = useSmartStartStore((state) => state.recordProviderUse);
  const preferences = useSmartStartStore((state) => state.preferences);
  const lastUsed = useLastUsedProviderOrder();
  const taskKind = useDraftTaskKind(input.projectId, autoOn);
  const providerConfigs = useSharedSettings((state) => state.providerConfigs);
  const providerModelPreferences = useSharedSettings((state) => state.providerModelPreferences);
  const instances = useSharedSettings((state) => state.agentInstances);
  const pools = useAccountPools();
  // Usage pushes re-render the draft only while Auto is on.
  const snapshots = useProviderUsageStore((state) => (autoOn ? state.snapshots : NO_SNAPSHOTS));
  // A draft is short-lived: judge usage windows as of when it opened (usage
  // pushes still update the pick), so the composer never re-renders on a clock.
  const [now] = useState(() => Date.now());
  // Set while the owner chose the account themselves (in the model picker or
  // with "Change"): Auto then never switches the draft, and the row names
  // whatever account the draft is on. `resume` is Auto's own pick at that
  // moment; it stays the incumbent for the automatic pick, so "back to the
  // automatic pick" returns to it instead of sticking to the owner's choice.
  // Scoped to the project, since the draft view can move between projects.
  const [ownerChoice, setOwnerChoice] = useState<
    { projectId: string; resume: string | undefined } | undefined
  >(undefined);
  const overridden = autoOn && ownerChoice?.projectId === input.projectId;

  const candidateInput: SmartStartCandidateInput = {
    agents: input.agents,
    disabledAgents: input.disabledAgents,
    presentationMode: input.presentationMode,
    lastDraftConfig: input.lastDraftConfig,
    // Home starts every provider from its defaults (as the draft itself does).
    providerConfigs: input.homeScope ? NO_PROVIDER_CONFIGS : providerConfigs,
    providerModelPreferences,
    pools,
    instances,
    snapshots,
    now,
    usageIdFor: (agentKind) => usageProviderIdForAgent(agentKind, undefined, instances),
    rankOf: getProviderModelPickerRank,
  };
  const candidates = autoOn ? buildSmartStartCandidates(candidateInput) : [];
  const decision: SmartStartDecision | undefined = autoOn
    ? decideSmartStart({
        candidates,
        preferenceOrder: resolvePreferenceOrder(taskKind, preferences, lastUsed),
        // The draft's account (its last-used one before Auto's first pick) is
        // kept unless another one is clearly better.
        currentAgentKind: overridden ? ownerChoice?.resume : input.currentAgentKind,
      })
    : undefined;
  const autoPick = decision?.kind === "pick" ? decision.pick.agentKind : undefined;
  // The owner's choice is named even when Auto could not have picked it
  // (for example an account that still needs a sign-in).
  const currentAgent = overridden
    ? input.agents.find((agent) => agent.kind === input.currentAgentKind)
    : undefined;
  const ownerPick = currentAgent
    ? (candidates.find((candidate) => candidate.agentKind === currentAgent.kind) ??
      describeSmartStartAccount(currentAgent, candidateInput))
    : undefined;
  const target = overridden ? undefined : autoPick;

  const { currentAgentKind, selectAgent } = input;
  useEffect(() => {
    if (!target || target === currentAgentKind) return;
    selectAgent(target);
  }, [target, currentAgentKind, selectAgent]);

  const noteOwnerChoice = () => {
    if (!overridden) setOwnerChoice({ projectId: input.projectId, resume: autoPick });
  };
  const chooseOverride = (agentKind: string) => {
    noteOwnerChoice();
    selectAgent(agentKind);
  };
  const backToAuto = () => {
    setOwnerChoice(undefined);
    // Switch now: as the incumbent, the owner's choice would otherwise be kept on a close call.
    if (autoPick) selectAgent(autoPick);
  };
  const setAutoFor = (next: boolean) => {
    setOwnerChoice(undefined);
    setAuto(input.projectId, next);
  };

  const toggle: ComposerControl = {
    kind: "toggle",
    label: SMART_START_CONTROL_LABEL,
    displayLabel: msg`Auto`,
    icon: <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />,
    isSelected: autoOn,
    onChange: setAutoFor,
    hideLabelOnWrap: true,
    tier: 1,
  };

  return {
    active: autoOn,
    decorateControls: (controls) =>
      available
        ? withSmartStartControls(controls, toggle, autoOn ? noteOwnerChoice : undefined)
        : controls,
    panel:
      autoOn && decision ? (
        <SmartStartPanel
          decision={decision}
          override={ownerPick}
          taskKind={taskKind}
          agents={input.agents}
          instances={instances}
          onOverride={chooseOverride}
          onBackToAuto={backToAuto}
          onTurnOff={() => setAutoFor(false)}
        />
      ) : null,
    wrapStart: (onStart) => (startInput) => {
      // Auto's own picks are not the owner's habit; hand-picked starts are.
      if (input.enabled && (!autoOn || overridden)) {
        recordProviderUse(smartStartProviderOf(startInput.agentKind));
      }
      return onStart(startInput);
    },
  };
}
