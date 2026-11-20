/**
 * ViscosityCode: the playbook catalog — built-ins, edited built-ins and the
 * user's own — and its writes to the host setting `playbooks`.
 *
 * The host setting holds only what differs from the built-ins: an entry whose
 * id is a built-in id replaces that built-in (Reset deletes it), any other
 * entry is a custom playbook. Remote clients edit the selected host's list.
 */
import { useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  MAX_SAVED_PLAYBOOKS,
  normalizeSavedPlaybooks,
  savedPlaybookSchema,
  type SavedPlaybook,
} from "@/shared/viscosity/playbook";
import { BUILT_IN_PLAYBOOK_IDS, builtInPlaybooks } from "./builtInPlaybooks";

export interface PlaybookCatalogEntry {
  playbook: SavedPlaybook;
  builtIn: boolean;
  /** A built-in replaced by the user's edited copy. */
  edited: boolean;
}

const EMPTY: readonly SavedPlaybook[] = [];

export function mergePlaybookCatalog(
  builtIns: readonly SavedPlaybook[],
  saved: readonly SavedPlaybook[],
): PlaybookCatalogEntry[] {
  const savedById = new Map(saved.map((entry) => [entry.id, entry]));
  return [
    ...builtIns.map((builtIn) => {
      const edited = savedById.get(builtIn.id);
      return { playbook: edited ?? builtIn, builtIn: true, edited: edited !== undefined };
    }),
    ...saved
      .filter((entry) => !BUILT_IN_PLAYBOOK_IDS.has(entry.id))
      .map((playbook) => ({ playbook, builtIn: false, edited: false })),
  ];
}

export function usePlaybookCatalog(): PlaybookCatalogEntry[] {
  const { t } = useLingui();
  const saved = useSharedSettings((state) => state.playbooks ?? EMPTY);
  return mergePlaybookCatalog(
    builtInPlaybooks((descriptor: MessageDescriptor) => t(descriptor)),
    saved,
  );
}

/** A fresh custom id: `c-` plus 8 hex digits, unused in `taken`. */
export function newCustomPlaybookId(taken: ReadonlySet<string>): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const id = `c-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (!taken.has(id)) return id;
  }
}

/** Insert or replace by id; returns undefined when the entry is invalid or the list is full. */
export function upsertSavedPlaybook(
  saved: readonly SavedPlaybook[],
  playbook: SavedPlaybook,
  now = Date.now(),
): SavedPlaybook[] | undefined {
  const parsed = savedPlaybookSchema.safeParse({ ...playbook, updatedAt: now });
  if (!parsed.success) return undefined;
  const index = saved.findIndex((entry) => entry.id === parsed.data.id);
  if (index < 0) {
    return saved.length >= MAX_SAVED_PLAYBOOKS ? undefined : [...saved, parsed.data];
  }
  return saved.map((entry, entryIndex) => (entryIndex === index ? parsed.data : entry));
}

type PlaybookSettingsWriter = { setPlaybooks?: (playbooks: SavedPlaybook[]) => void };

/** False when the store has no playbooks setter, so callers report the failure. */
function writeSavedPlaybooks(next: SavedPlaybook[]): boolean {
  // The store setter persists through the shared-settings write path (host owner).
  const { setPlaybooks } = useSharedSettings.getState() as PlaybookSettingsWriter;
  if (!setPlaybooks) return false;
  setPlaybooks(normalizeSavedPlaybooks(next));
  return true;
}

function readSaved(): readonly SavedPlaybook[] {
  return useSharedSettings.getState().playbooks ?? EMPTY;
}

/** Save an edited built-in or a custom playbook. False when it could not be stored. */
export function savePlaybook(playbook: SavedPlaybook): boolean {
  const next = upsertSavedPlaybook(readSaved(), playbook);
  if (!next) return false;
  return writeSavedPlaybooks(next);
}

/** Delete a custom playbook, or reset a built-in to its shipped text. False when it could not be stored. */
export function removeSavedPlaybook(id: string): boolean {
  const saved = readSaved();
  const next = saved.filter((entry) => entry.id !== id);
  return next.length === saved.length || writeSavedPlaybooks(next);
}
