/**
 * ViscosityCode: Smart start preference lists, pure edits (fork of Poracode).
 *
 * A preference list is an ordered list of providers (agent kinds). The editor
 * shows the effective order (the owner's list, or the last-used order) with
 * every other known provider after it, and saves the whole order on any move.
 */

/** `order` followed by the `known` providers it does not list yet, without duplicates. */
export function completeProviderOrder(
  order: readonly string[],
  known: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const provider of [...order, ...known]) {
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

/** `order` with the entry at `index` moved by `delta` places; unchanged when out of range. */
export function moveProvider(order: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(index, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}
