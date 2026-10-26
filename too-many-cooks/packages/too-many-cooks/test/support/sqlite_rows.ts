/// Shared sqlite raw-row narrowing helpers for tests ([DEDUP-DESLOP]).
///
/// sqlite_master queries and `pragma table_info(...)` return untyped
/// rows; these narrow them to column/table names without casts.

import { getStringField, isRecord } from "./json.js";

/** Narrows a raw sqlite row to its `name` string. */
export const rowName = (row: unknown): string => {
  if (!isRecord(row)) { throw new Error("expected a sqlite row record"); }
  return getStringField(row, "name");
};

/** Narrows `pragma table_info(...)` output to its column names. */
export const pragmaColumnNames = (rows: unknown): readonly string[] => {
  if (!Array.isArray(rows)) { throw new Error("expected pragma rows"); }
  return rows.map(rowName);
};
