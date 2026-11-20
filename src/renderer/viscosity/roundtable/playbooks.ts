/**
 * ViscosityCode Roundtable: playbooks for seats.
 *
 * A Roundtable stores playbook ids only (`RoundtableSession.playbookId` for
 * the table, `ParticipantProfile.playbookId` per seat, where `null` means
 * none). The id is resolved against the catalog when a seat's thread is
 * created, and the thread keeps the frozen copy (`ThreadConfig.playbook`), so
 * delivery is the supervisor's, as for any chat.
 *
 * The catalog is the built-ins (labels in the UI language) with edited copies
 * from the `playbooks` host setting in their place, then the custom ones.
 */
import { useLingui } from "@lingui/react/macro";
import { playbookIdSchema, type SavedPlaybook } from "@/shared/viscosity/playbook";
import { i18n } from "@/renderer/i18n/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { builtInPlaybooks } from "@/renderer/viscosity/playbooks/builtInPlaybooks";
import { editingSeats } from "./engine/planner";
import type { ParticipantProfile, RoundtableSession } from "./types";

/** Built-ins (an edited copy replaces its built-in), then custom playbooks. */
export function mergePlaybookCatalog(
  builtInList: readonly SavedPlaybook[],
  saved: readonly SavedPlaybook[],
): SavedPlaybook[] {
  const savedById = new Map(saved.map((playbook) => [playbook.id, playbook]));
  const builtInIds = new Set(builtInList.map((playbook) => playbook.id));
  return [
    ...builtInList.map((playbook) => savedById.get(playbook.id) ?? playbook),
    ...saved.filter((playbook) => !builtInIds.has(playbook.id)),
  ];
}

export function roundtablePlaybookCatalog(): SavedPlaybook[] {
  return mergePlaybookCatalog(
    builtInPlaybooks((descriptor) => i18n._(descriptor)),
    useSharedSettings.getState().playbooks ?? [],
  );
}

export function useRoundtablePlaybookCatalog(): SavedPlaybook[] {
  // Subscribes to the UI language, so labels follow a language switch.
  const { i18n: active } = useLingui();
  const saved = useSharedSettings((state) => state.playbooks);
  return mergePlaybookCatalog(
    builtInPlaybooks((descriptor) => active._(descriptor)),
    saved ?? [],
  );
}

/** The seat's own choice wins; `null` is none; absent falls back to the table's. */
export function seatPlaybookId(
  session: Pick<RoundtableSession, "playbookId">,
  profile: Pick<ParticipantProfile, "playbookId">,
): string | undefined {
  if (profile.playbookId === null) return undefined;
  return profile.playbookId ?? session.playbookId;
}

export function findPlaybook(
  catalog: readonly SavedPlaybook[],
  id: string | undefined,
): SavedPlaybook | undefined {
  return id === undefined ? undefined : catalog.find((playbook) => playbook.id === id);
}

export function resolveSeatPlaybook(
  session: Pick<RoundtableSession, "playbookId">,
  profile: Pick<ParticipantProfile, "playbookId">,
  catalog: readonly SavedPlaybook[] = roundtablePlaybookCatalog(),
): SavedPlaybook | undefined {
  return findPlaybook(catalog, seatPlaybookId(session, profile));
}

/**
 * An API seat has no thread for the supervisor to brief, so its playbook's
 * instructions go after its own (read on every request).
 */
export function withSeatPlaybookInstructions(
  instructions: string | undefined,
  playbook: SavedPlaybook | undefined,
): string | undefined {
  if (!playbook) return instructions;
  const own = instructions?.trim();
  const block = `Playbook "${playbook.label}":\n${playbook.instructions}`;
  return own ? `${own}\n\n${block}` : block;
}

/**
 * The first seat that must edit files (see `editingSeats`) but resolves to a
 * read-only playbook, with that playbook; undefined when the setup can start.
 * A read-only reviewer or judge is fine, and so is a read-only table whose
 * editing seats choose another playbook or none.
 */
export function readOnlyEditingSeat(
  session: Pick<RoundtableSession, "pattern" | "participants" | "implementWinner" | "playbookId">,
  catalog: readonly SavedPlaybook[],
): { seat: ParticipantProfile; playbook: SavedPlaybook } | undefined {
  for (const seat of editingSeats(session)) {
    const playbook = resolveSeatPlaybook(session, seat, catalog);
    if (playbook?.readOnly === true) return { seat, playbook };
  }
  return undefined;
}

export function isPlaybookId(value: unknown): value is string {
  return playbookIdSchema.safeParse(value).success;
}
