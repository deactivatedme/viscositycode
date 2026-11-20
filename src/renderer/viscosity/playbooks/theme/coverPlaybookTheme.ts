/**
 * ViscosityCode: lets a panel drawn over the split view (the Roundtable center
 * view) stand in for the focused pane's playbook while it is shown, so the
 * playbook theme follows what is on screen. Read by PlaybookThemeController.
 */
import { useEffect, useId, useSyncExternalStore } from "react";
import { playbookBindingFromSaved, type ThreadPlaybookBinding } from "@/shared/viscosity/playbook";
import {
  findPlaybook,
  useRoundtablePlaybookCatalog,
} from "@/renderer/viscosity/roundtable/playbooks";

export interface CoverPlaybook {
  owner: string;
  /** Undefined: the covering panel has no playbook, so the user's theme shows. */
  binding: ThreadPlaybookBinding | undefined;
  key: string;
}

let cover: CoverPlaybook | null = null;
const listeners = new Set<() => void>();

function setCover(next: CoverPlaybook | null): void {
  if (cover === next) return;
  cover = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * While the calling component is mounted, the playbook theme follows `binding`
 * instead of the focused pane's playbook. Call it from a panel that covers the
 * panes, e.g. `useCoverPlaybookTheme(playbook && playbookBindingFromSaved(playbook))`.
 */
export function useCoverPlaybookTheme(binding: ThreadPlaybookBinding | undefined): void {
  const owner = useId();
  const key = binding ? JSON.stringify(binding) : "";
  // Callers rebuild the binding each render; only a changed value notifies.
  useEffect(() => {
    if (cover?.owner === owner && cover.key === key) return;
    setCover({ owner, binding, key });
  });
  useEffect(
    () => () => {
      if (cover?.owner === owner) setCover(null);
    },
    [owner],
  );
}

/**
 * For the Roundtable center view: while mounted, the playbook theme follows the
 * session's table playbook (`RoundtableSession.playbookId`), resolved against
 * the same catalog the seats use. An unknown or absent id shows the user's theme.
 */
export function useRoundtablePlaybookTheme(playbookId: string | undefined): void {
  const playbook = findPlaybook(useRoundtablePlaybookCatalog(), playbookId);
  useCoverPlaybookTheme(playbook && playbookBindingFromSaved(playbook));
}

/** The covering panel's playbook, or null when no panel covers the panes. */
export function useCoverPlaybook(): CoverPlaybook | null {
  return useSyncExternalStore(
    subscribe,
    () => cover,
    () => null,
  );
}
