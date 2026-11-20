/**
 * ViscosityCode: compact Roundtable seat pickers shared by the new-thread
 * composer panel and the invite dialog, built on upstream's `OptionMenu` and
 * `ProviderIcon` (the provider icon registry, never a provider name).
 */
import { useLingui } from "@lingui/react/macro";
import { Shapes, UserPlus } from "lucide-react";
import { OptionMenu } from "@/renderer/components/common/OptionMenu";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import type { RoundtablePattern } from "../types";
import type { SeatCandidate } from "./participants";
import { isRoundtablePattern, ROUNDTABLE_PATTERN_OPTIONS } from "./patterns";

export function SeatIcon(props: { candidate: SeatCandidate }) {
  const { candidate } = props;
  return (
    <ProviderIcon
      kind={candidate.agentKind}
      fallbackLabel={candidate.providerLabel}
      className="size-3.5 shrink-0"
    />
  );
}

export function ParticipantAddMenu(props: {
  candidates: readonly SeatCandidate[];
  /** Already seated (or the composer's own model): not offered again. */
  excludeIds: readonly string[];
  isDisabled?: boolean;
  iconOnly?: boolean;
  onAdd: (candidate: SeatCandidate) => void;
}) {
  const { t } = useLingui();
  const available = props.candidates.filter(
    (candidate) => !props.excludeIds.includes(candidate.id),
  );
  const options = available.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    icon: <SeatIcon candidate={candidate} />,
    hint: candidate.presentationMode === "terminal" ? t`CLI` : t`Chat`,
  }));
  return (
    <OptionMenu
      value=""
      options={options}
      placeholder={t`Add participant`}
      tooltip={t`Add participant`}
      icon={<UserPlus className="size-3.5" />}
      buttonVariant="ghost"
      {...(props.iconOnly ? { iconOnly: true, className: "size-6 min-w-0 px-0 text-muted" } : {})}
      isDisabled={props.isDisabled ?? false}
      onChange={(id) => {
        const candidate = available.find((entry) => entry.id === id);
        if (candidate) props.onAdd(candidate);
      }}
    />
  );
}

export function PatternMenu(props: {
  value: RoundtablePattern;
  isDisabled?: boolean;
  compact?: boolean;
  onChange: (pattern: RoundtablePattern) => void;
}) {
  const { t } = useLingui();
  const options = ROUNDTABLE_PATTERN_OPTIONS.map((option) => ({
    id: option.id,
    label: t(option.label),
    hint: t(option.hint),
  }));
  return (
    <OptionMenu
      value={props.value}
      options={options}
      placeholder={t`Pattern`}
      tooltip={t`How participants take turns`}
      icon={<Shapes className="size-3.5" />}
      buttonVariant="ghost"
      {...(props.compact ? { className: "h-6 min-w-0 px-1.5 text-xs" } : {})}
      isDisabled={props.isDisabled ?? false}
      onChange={(value) => {
        if (isRoundtablePattern(value)) props.onChange(value);
      }}
    />
  );
}
