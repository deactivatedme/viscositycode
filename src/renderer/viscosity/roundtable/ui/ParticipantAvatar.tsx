/**
 * ViscosityCode Roundtable UI: a participant's avatar. A bot's own glyph and
 * colour when it has one, otherwise the agent's provider icon from the shared
 * registry (never a provider-specific import), or an API glyph for a model
 * reached over an API.
 */
import type { CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import type { ParticipantProfile } from "../types";

const LITERAL_COLOR = /^(#|rgb|hsl|oklch|oklab|color-mix|var\()/i;

/** A hex/functional colour as is; a bare token name ("accent") as its CSS variable. */
export function avatarColorValue(color: string): string {
  const trimmed = color.trim();
  return LITERAL_COLOR.test(trimmed) ? trimmed : `var(--${trimmed.replace(/^-+/, "")})`;
}

export function ParticipantAvatar(props: {
  participant: Pick<ParticipantProfile, "label" | "brain" | "avatar">;
  size?: "sm" | "md";
}) {
  const { participant } = props;
  const size = props.size ?? "md";
  if (participant.avatar) {
    const style = {
      "--vc-rt-avatar-color": avatarColorValue(participant.avatar.color),
    } as CSSProperties;
    return (
      <span aria-hidden="true" className="vc-rt-avatar" data-size={size} style={style}>
        {participant.avatar.glyph}
      </span>
    );
  }
  if (participant.brain.kind === "agent") {
    return (
      <span aria-hidden="true" className="vc-rt-avatar vc-rt-avatar--provider" data-size={size}>
        <ProviderIcon
          kind={participant.brain.agentKind}
          fallbackLabel={participant.label}
          className="vc-rt-avatar__icon"
        />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="vc-rt-avatar vc-rt-avatar--api" data-size={size}>
      <Sparkles className="vc-rt-avatar__icon" />
    </span>
  );
}

/** Overlapping avatars for a list row (participants in seat order). */
export function ParticipantAvatarStack(props: {
  participants: readonly Pick<ParticipantProfile, "id" | "label" | "brain" | "avatar">[];
}) {
  if (props.participants.length === 0) return null;
  return (
    <span className="vc-rt-avatar-stack" aria-hidden="true">
      {props.participants.map((participant) => (
        <ParticipantAvatar key={participant.id} participant={participant} size="sm" />
      ))}
    </span>
  );
}
