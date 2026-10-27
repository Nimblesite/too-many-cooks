/// Shared JSON narrowing helpers for tests ([DEDUP-DESLOP]).
///
/// The ONE place tests parse JSON: parse to `unknown`, then narrow with
/// `isRecord` — never `as` casts. Field accessors throw descriptive
/// errors when the shape is wrong, so malformed payloads fail tests
/// loudly instead of silently coercing.

import { isRecord } from "../../src/json-guards.js";

const SNIPPET_MAX_CHARS = 120;

// `isRecord` is defined once for src and tests ([DEDUP-DESLOP]); re-exported
// here so tests keep one import path for JSON narrowing.
export { isRecord };

/** Short rendering of an unexpected value for error messages. */
const snippet = (value: unknown): string =>
  (JSON.stringify(value) ?? String(value)).slice(0, SNIPPET_MAX_CHARS);

/** Parses JSON text and narrows to a record; throws otherwise. */
export const parseJsonRecord = (text: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`Expected a JSON object but got: ${snippet(parsed)}`);
  }
  return parsed;
};

/** Reads a required string field; throws descriptively when absent/wrong. */
export const getStringField = (
  record: Record<string, unknown>,
  key: string,
): string => {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected field "${key}" to be a string, got: ${snippet(value)}`);
  }
  return value;
};

/** Reads a required number field; throws descriptively when absent/wrong. */
export const getNumberField = (
  record: Record<string, unknown>,
  key: string,
): number => {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected field "${key}" to be a number, got: ${snippet(value)}`);
  }
  return value;
};

/** Reads a required record field; throws descriptively when absent/wrong. */
export const getRecordField = (
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> => {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Expected field "${key}" to be a record, got: ${snippet(value)}`);
  }
  return value;
};

/** Reads a required array field; throws descriptively when absent/wrong. */
export const getArrayField = (
  record: Record<string, unknown>,
  key: string,
): unknown[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected field "${key}" to be an array, got: ${snippet(value)}`);
  }
  return value;
};

/** Reads a required array-of-records field; throws when any element differs. */
export const getRecordArrayField = (
  record: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> => {
  const elements = getArrayField(record, key);
  const records: Array<Record<string, unknown>> = [];
  for (const element of elements) {
    if (!isRecord(element)) {
      throw new Error(`Expected every element of "${key}" to be a record, got: ${snippet(element)}`);
    }
    records.push(element);
  }
  return records;
};
