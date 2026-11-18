/**
 * ViscosityCode: the task kind of a project's new-thread draft (fork of Poracode).
 *
 * The draft composer already checkpoints its editor content into
 * `useAppStore.draftContents[projectId]` on every edit, so Smart start reads
 * the prompt from there instead of hooking the editor. The classification is
 * cached per saved content object, and the selector returns a plain string,
 * so the composer re-renders only when the guessed kind flips, never on
 * keystrokes or streaming updates elsewhere in the store.
 */
import { useAppStore } from "@/renderer/state/appStore";
import type { DraftContent } from "@/renderer/state/slices/types";
import { classifyTaskKind, taskKindInputFromSegments, type SmartStartTaskKind } from "./taskKind";

const classified = new WeakMap<DraftContent, SmartStartTaskKind | null>();

/** The task kind of a saved draft (cached per content object). */
export function draftTaskKind(content: DraftContent | undefined): SmartStartTaskKind | undefined {
  if (!content) return undefined;
  const cached = classified.get(content);
  if (cached !== undefined) return cached ?? undefined;
  const kind = classifyTaskKind(taskKindInputFromSegments(content.segments));
  classified.set(content, kind ?? null);
  return kind;
}

/** The project's draft task kind while `enabled`; undefined otherwise. */
export function useDraftTaskKind(
  projectId: string,
  enabled: boolean,
): SmartStartTaskKind | undefined {
  return useAppStore((state) =>
    enabled && Object.hasOwn(state.draftContents, projectId)
      ? draftTaskKind(state.draftContents[projectId])
      : undefined,
  );
}
