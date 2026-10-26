// Shared helpers for commands that act on tree-view selections.
// A command receives the clicked item plus the full multi-selection;
// These helpers normalize that into a list and extract typed values.

/** Prefer the full selection; fall back to the single clicked item. */
export function pickSelection<T>(
  item: T | undefined,
  selection: readonly T[] | undefined,
): readonly T[] {
  if (typeof selection !== 'undefined' && selection.length > 0) { return selection; }
  if (typeof item === 'undefined') { return []; }
  return [item];
}

/** Extract non-null values, skipping duplicates, preserving order. */
export function collectDistinct<TItem, TValue>(
  items: readonly TItem[],
  extract: (item: TItem) => TValue | null,
): TValue[] {
  const out: TValue[] = [];
  for (const candidate of items) {
    const value: TValue | null = extract(candidate);
    if (value !== null && !out.includes(value)) { out.push(value); }
  }
  return out;
}
