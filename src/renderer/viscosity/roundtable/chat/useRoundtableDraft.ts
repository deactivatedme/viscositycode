/**
 * ViscosityCode: Roundtable mode for the new-thread composer.
 *
 * Mirrors upstream's Experiment toggle: the "+" menu switches the draft into
 * Roundtable mode, a dock above the input lists the extra participants and the
 * pattern, and Send starts a Roundtable (the composer's own model takes seat
 * 0) instead of a single thread. State is local to the mounted composer.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { ParticipantProfile, RoundtablePattern } from "../types";
import { useRoundtableChatAvailable } from "./availability";
import { startRoundtableFromChat } from "./start";
import { modelParticipantId, seatProfiles, type SeatCandidate } from "./participants";
import {
  DEFAULT_ROUNDTABLE_PATTERN,
  MAX_ROUNDTABLE_PARTICIPANTS,
  rolesForPattern,
} from "./patterns";

/** The composer's current selection, which takes the first seat. */
export interface RoundtableDraftPrimary {
  agentKind: string;
  agentLabel: string;
  model: string;
  modelLabel: string;
  presentationMode: "gui" | "terminal";
}

export function primarySeatId(
  primary: Pick<RoundtableDraftPrimary, "agentKind" | "model">,
): string {
  return modelParticipantId(primary.agentKind, primary.model);
}

export function primaryProfile(
  primary: RoundtableDraftPrimary,
  role: ParticipantProfile["role"],
): ParticipantProfile {
  return {
    id: primarySeatId(primary),
    label: primary.modelLabel
      ? `${primary.agentLabel} · ${primary.modelLabel}`
      : primary.agentLabel,
    role,
    brain: {
      kind: "agent",
      agentKind: primary.agentKind,
      model: primary.model,
      presentationMode: primary.presentationMode,
    },
  };
}

export interface StartDraftRoundtableInput {
  projectId: string;
  task: string;
  pattern: RoundtablePattern;
  primary: RoundtableDraftPrimary;
  seats: readonly SeatCandidate[];
  /** The draft asked for a new worktree; otherwise the current checkout is shared. */
  newWorktree: boolean;
}

export function startDraftRoundtable(input: StartDraftRoundtableInput): Promise<string> {
  const primaryId = primarySeatId(input.primary);
  const seats = input.seats.filter((seat) => seat.id !== primaryId);
  const roles = rolesForPattern(input.pattern, seats.length + 1);
  return startRoundtableFromChat({
    task: input.task,
    pattern: input.pattern,
    projectId: input.projectId,
    participants: [
      primaryProfile(input.primary, roles[0] ?? "member"),
      ...seatProfiles(input.pattern, seats, { originSeat: true }),
    ],
    worktree: input.newWorktree ? { mode: "new-branch" } : { mode: "current" },
  });
}

export interface RoundtableDraftState {
  /** The toggle is offered (desktop shell and a composer that can host it). */
  available: boolean;
  enabled: boolean;
  pattern: RoundtablePattern;
  /** Extra participants beside the composer's own model. */
  seats: readonly SeatCandidate[];
  /** Two to five seats in total, the composer's model included. */
  canStart: boolean;
  isFull: boolean;
  submitLabel: string;
  setEnabled: (next: boolean) => void;
  setPattern: (pattern: RoundtablePattern) => void;
  addSeat: (candidate: SeatCandidate) => void;
  removeSeat: (id: string) => void;
  reset: () => void;
}

const MAX_EXTRA_SEATS = MAX_ROUNDTABLE_PARTICIPANTS - 1;

export function useRoundtableDraft(options: { canHost: boolean }): RoundtableDraftState {
  const { t } = useLingui();
  const shell = useRoundtableChatAvailable();
  const available = shell && options.canHost;
  const [enabledState, setEnabledState] = useState(false);
  const [pattern, setPattern] = useState<RoundtablePattern>(DEFAULT_ROUNDTABLE_PATTERN);
  const [seats, setSeats] = useState<SeatCandidate[]>([]);
  const enabled = available && enabledState;
  return {
    available,
    enabled,
    pattern,
    seats,
    canStart: enabled && seats.length >= 1 && seats.length <= MAX_EXTRA_SEATS,
    isFull: seats.length >= MAX_EXTRA_SEATS,
    submitLabel: t`Start Roundtable`,
    setEnabled: (next) => {
      setEnabledState(next);
      if (!next) setSeats([]);
    },
    setPattern,
    addSeat: (candidate) =>
      setSeats((current) =>
        current.length >= MAX_EXTRA_SEATS || current.some((seat) => seat.id === candidate.id)
          ? current
          : [...current, candidate],
      ),
    removeSeat: (id) => setSeats((current) => current.filter((seat) => seat.id !== id)),
    reset: () => {
      setEnabledState(false);
      setSeats([]);
      setPattern(DEFAULT_ROUNDTABLE_PATTERN);
    },
  };
}
