/// Shared sqlite raw-row narrowing helpers for tests ([DEDUP-DESLOP]).
///
/// sqlite_master queries and `pragma table_info(...)` return untyped
/// rows; these narrow them to column/table names without casts.

import assert from "node:assert";
import Database from "better-sqlite3";

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

/** Opens `dbPath` read-only and returns the column names of `table`. */
export const columnNamesOf = (
  dbPath: string,
  table: string,
): readonly string[] => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    return pragmaColumnNames(db.pragma(`table_info(${table})`));
  } finally {
    db.close();
  }
};

/** Drops `column` from `table` directly, to simulate schema drift. */
export const dropColumn = (
  dbPath: string,
  table: string,
  column: string,
): void => {
  const db: Database.Database = new Database(dbPath);
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } finally {
    db.close();
  }
};

/** Tables the TMC schema must create ([DB-MIGRATE]). */
export const REQUIRED_TABLES: readonly string[] = [
  "identity",
  "locks",
  "messages",
  "message_reads",
  "plans",
];

/** Every non-internal table present in `dbPath`. */
export const tableNames = (dbPath: string): readonly string[] => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const rows: readonly unknown[] = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    return rows.map(rowName);
  } finally {
    db.close();
  }
};

/// Asserts every [DB-MIGRATE] required table exists in `dbPath`; `context`
/// describes what was expected to create them.
export const assertTablesPresent = (
  dbPath: string,
  context: string,
): void => {
  const present: readonly string[] = tableNames(dbPath);
  for (const table of REQUIRED_TABLES) {
    assert.ok(
      present.includes(table),
      `${context} '${table}' must exist. Got: ${present.join(", ")}`,
    );
  }
};
