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

/**
 * Runs `sql` against `dbPath` with `foreignKeys` enforced or not, then closes.
 * Tests use it to write raw DDL the app itself must never issue.
 */
export const execRawSql = (
  dbPath: string,
  sql: string,
  foreignKeys: "ON" | "OFF",
): void => {
  const db: Database.Database = new Database(dbPath);
  db.pragma(`foreign_keys = ${foreignKeys}`);
  try {
    db.exec(sql);
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

/** Asserts `table`.`column` exists in `dbPath`; `context` says why. */
export const assertColumnPresent = (
  dbPath: string,
  table: string,
  column: string,
  context: string,
): void => {
  const cols: readonly string[] = columnNamesOf(dbPath, table);
  assert.ok(
    cols.includes(column),
    `${context}: ${table}.${column} must exist. Got cols: ${cols.join(",")}`,
  );
};

/** Asserts `table`.`column` is absent from `dbPath`; `context` says why. */
export const assertColumnAbsent = (
  dbPath: string,
  table: string,
  column: string,
  context: string,
): void => {
  const cols: readonly string[] = columnNamesOf(dbPath, table);
  assert.ok(
    !cols.includes(column),
    `${context}: ${table}.${column} must be gone. Got cols: ${cols.join(",")}`,
  );
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
