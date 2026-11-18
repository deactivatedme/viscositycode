/**
 * ViscosityCode: the "Let ViscosityCode pick" dock row (fork of Poracode).
 *
 * Shown above the new-thread composer's input while Auto is on. It names the
 * account and model the thread will start on ("Will use: <provider> · <account>
 * · <model> — 72% left"), lets the owner override it with one pick ("Change"), go back
 * to the automatic pick, edit the task-kind preferences, or turn Auto off.
 * With nothing to pick from it says so and the manual model picker applies.
 */
import { useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { RotateCcw, Settings2, Sparkles, X } from "lucide-react";
import { BRAND_NAME } from "@/shared/brand";
import type { AgentInstanceConfigMap, AgentStatus } from "@/shared/contracts";
import { OptionMenu } from "@/renderer/components/common/OptionMenu";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { getProviderManifest } from "@/renderer/components/providers/providerManifest";
import { resolveModelLabel } from "@/renderer/components/providers/modelDisplay";
import {
  ThreadDockHeader,
  ThreadDockIconButton,
  ThreadDockList,
  ThreadDockRow,
  ThreadDockSection,
} from "@/renderer/components/thread/ThreadDockUI";
import { AGENT_ACCENT_CSS, agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import { smartStartAccountName, smartStartPickName } from "./labels";
import type { SmartStartCandidate, SmartStartDecision } from "./scoring";
import { SmartStartPreferencesDialog } from "./SmartStartPreferences";
import type { SmartStartTaskKind } from "./taskKind";

export interface SmartStartPanelProps {
  decision: SmartStartDecision;
  /** The account the owner chose instead of the pick (the draft's current one), if any. */
  override: SmartStartCandidate | undefined;
  taskKind: SmartStartTaskKind | undefined;
  agents: readonly AgentStatus[];
  instances: AgentInstanceConfigMap | undefined;
  onOverride: (agentKind: string) => void;
  onBackToAuto: () => void;
  onTurnOff: () => void;
}

/** The composer's input around `element`, to return focus to when a pressed action disappears. */
function composerInputNear(element: Element | null): HTMLElement | null {
  return (
    element
      ?.closest("[data-poracode-composer]")
      ?.querySelector<HTMLElement>(
        '[data-composer-input-anchor] textarea, [data-composer-input-anchor] [contenteditable="true"]',
      ) ?? null
  );
}

export function SmartStartPanel(props: SmartStartPanelProps) {
  const { t } = useLingui();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  // "Back to the automatic pick" and "Turn off Auto" remove the button that
  // was pressed; keep keyboard focus in the composer instead of losing it.
  const thenFocusInput = (action: () => void) => () => {
    const input = composerInputNear(statusRef.current);
    action();
    input?.focus();
  };

  const providerLabel = (agentKind: string): string => {
    const manifest = getProviderManifest(agentKind);
    if (manifest) return t(manifest.label);
    return props.agents.find((agent) => agent.kind === agentKind)?.label ?? agentKind;
  };
  const nameOf = (candidate: SmartStartCandidate): string =>
    smartStartPickName({
      providerLabel: providerLabel(candidate.agentKind),
      accountName: smartStartAccountName(candidate.agentKind, props.instances),
      modelLabel: resolveModelLabel(
        props.agents.find((agent) => agent.kind === candidate.agentKind),
        candidate.model,
      ),
    });
  const usageOf = (candidate: SmartStartCandidate): string => {
    if (candidate.availability.kind === "exhausted") return t`out of usage`;
    const left = candidate.percentLeft;
    return left === undefined ? t`usage not reported` : t`${left}% left`;
  };

  const override = props.override;
  const decision = props.decision;
  const shown = override ?? (decision.kind === "pick" ? decision.pick : undefined);
  const alternatives =
    decision.kind === "pick"
      ? decision.ranked.filter((candidate) => candidate.agentKind !== shown?.agentKind)
      : [];
  const taskKindLabel =
    props.taskKind === "coding"
      ? t`Coding task`
      : props.taskKind === "quick"
        ? t`Quick question`
        : undefined;

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {alternatives.length > 0 ? (
        <OptionMenu
          value=""
          options={alternatives.map((candidate) => ({
            id: candidate.agentKind,
            label: nameOf(candidate),
            icon: <ProviderIcon kind={candidate.agentKind} className="size-3.5 shrink-0" />,
            hint: usageOf(candidate),
          }))}
          placeholder={t`Change`}
          tooltip={t`Start on another account`}
          buttonVariant="ghost"
          className="h-6 min-w-0 px-1.5 text-xs"
          onChange={props.onOverride}
        />
      ) : null}
      {override ? (
        <ThreadDockIconButton
          label={t`Back to the automatic pick`}
          onPress={thenFocusInput(props.onBackToAuto)}
        >
          <RotateCcw className="size-3.5" />
        </ThreadDockIconButton>
      ) : null}
      <ThreadDockIconButton
        label={t`Smart start preferences`}
        onPress={() => setPreferencesOpen(true)}
      >
        <Settings2 className="size-3.5" />
      </ThreadDockIconButton>
      <ThreadDockIconButton label={t`Turn off Auto`} onPress={thenFocusInput(props.onTurnOff)}>
        <X className="size-3.5" />
      </ThreadDockIconButton>
    </div>
  );

  const brand = BRAND_NAME;
  return (
    <ThreadDockSection ariaLabel={t`Let ${brand} pick`} placement="composer">
      <ThreadDockHeader
        icon={Sparkles}
        title={t`Auto`}
        {...(taskKindLabel ? { countLabel: taskKindLabel } : {})}
        actions={actions}
      />
      <ThreadDockList placement="composer" gap="1">
        <ThreadDockRow>
          <div
            ref={statusRef}
            className="flex min-w-0 flex-1 items-center gap-2"
            role="status"
            aria-live="polite"
            data-vc-smart-start=""
            {...(shown ? agentKindAttribute(shown.agentKind) : {})}
          >
            {shown ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-0.5 shrink-0 rounded-full"
                  style={{ background: AGENT_ACCENT_CSS }}
                />
                <ProviderIcon kind={shown.agentKind} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate leading-5 text-foreground">
                  {override ? (
                    <Trans>Your pick: {nameOf(shown)}</Trans>
                  ) : (
                    <Trans>Will use: {nameOf(shown)}</Trans>
                  )}
                </span>
                <span className="shrink-0 truncate text-[color:var(--muted)]">
                  {usageOf(shown)}
                </span>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate leading-5 text-[color:var(--muted)]">
                {decision.kind === "none" && decision.reason === "all-exhausted" ? (
                  <Trans>Every ready account is out of usage. Pick one in the model picker.</Trans>
                ) : (
                  <Trans>No agent is ready to pick from. Pick one in the model picker.</Trans>
                )}
              </span>
            )}
          </div>
        </ThreadDockRow>
      </ThreadDockList>
      {preferencesOpen ? (
        <SmartStartPreferencesDialog onClose={() => setPreferencesOpen(false)} />
      ) : null}
    </ThreadDockSection>
  );
}
