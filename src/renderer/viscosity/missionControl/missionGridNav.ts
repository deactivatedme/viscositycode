/**
 * ViscosityCode Mission Control: arrow-key movement in the card grid (fork of
 * Poracode). Pure, so the grid's keyboard model is testable without layout.
 */

/** Index the key moves focus to, or null when the key is not a grid key (or cannot move). */
export function nextGridIndex(
  key: string,
  index: number,
  count: number,
  columns: number,
): number | null {
  if (count <= 0) return null;
  const perRow = Math.max(1, Math.floor(columns));
  let next: number;
  switch (key) {
    case "ArrowRight":
      next = index + 1;
      break;
    case "ArrowLeft":
      next = index - 1;
      break;
    case "ArrowDown":
      next = index + perRow;
      break;
    case "ArrowUp":
      next = index - perRow;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return null;
  }
  if (next < 0 || next >= count || next === index) return null;
  return next;
}

/** Cards in the first row of a laid-out grid: how many share the first card's top edge. */
export function countGridColumns(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  const first = tops[0]!;
  let columns = 0;
  for (const top of tops) {
    if (Math.abs(top - first) > 1) break;
    columns += 1;
  }
  return Math.max(1, columns);
}
