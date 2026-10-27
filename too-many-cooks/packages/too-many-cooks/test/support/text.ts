/// Shared text helpers for tests ([DEDUP-DESLOP]).

/** Splits `text` into trimmed, non-empty lines. */
export const nonEmptyLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0);
