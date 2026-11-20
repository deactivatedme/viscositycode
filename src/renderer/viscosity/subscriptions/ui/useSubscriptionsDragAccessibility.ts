/**
 * ViscosityCode: localized drag instructions and announcements for reordering
 * Subscriptions providers (fork of Poracode). A copy of the favorite models'
 * hook for plain `{ id, label }` items, with the same messages.
 */
import { Accessibility, type DragStartEvent } from "@dnd-kit/dom";
import { isSortable } from "@dnd-kit/react/sortable";
import { useLingui } from "@lingui/react/macro";
import { useLayoutEffect, useRef } from "react";

/** Replace the DnD library's English instructions and internal-ID announcements. */
export function useSubscriptionsDragAccessibility(items: readonly { id: string; label: string }[]) {
  const { t } = useLingui();
  // The plugin registers its callbacks once; keep their inventory current.
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);
  function describe(source: DragStartEvent["operation"]["source"]) {
    const item = itemsRef.current.find((candidate) => candidate.id === source?.id);
    if (!item || !source || !isSortable(source)) return undefined;
    return { name: item.label, position: source.index + 1, count: itemsRef.current.length };
  }
  function announceReordering({ operation: { source } }: Pick<DragStartEvent, "operation">) {
    const found = describe(source);
    if (!found) return;
    const { name, position, count } = found;
    return t`Reordering ${name}. Position ${position} of ${count}.`;
  }
  const options: NonNullable<ConstructorParameters<typeof Accessibility>[1]> = {
    screenReaderInstructions: {
      draggable: t`Press Space to start reordering. Use the arrow keys to move, Space to drop, or Escape to cancel.`,
    },
    announcements: {
      dragstart: announceReordering,
      dragover: announceReordering,
      dragend({ operation: { source }, canceled }) {
        if (canceled) return t`Reordering canceled.`;
        const found = describe(source);
        if (!found) return;
        const { name, position, count } = found;
        return t`Reordered ${name}. Position ${position} of ${count}.`;
      },
    },
  };
  return { plugin: Accessibility, options };
}
