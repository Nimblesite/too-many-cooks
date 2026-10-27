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

/** Type guard: value is a string. */
const isString = (value: unknown): value is string => typeof value === "string";

/** Type guard: value is a number. */
const isNumber = (value: unknown): value is number => typeof value === "number";

/** Type guard: value is an array of unknown elements. */
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** Reads required field `key`, narrowed by `guard`; throws when it fails. */
const readField = <T>(
  record: Record<string, unknown>,
  key: string,
  kind: string,
  guard: (value: unknown) => value is T,
): T => {
  const value = record[key];
  if (!guard(value)) {
    throw new Error(`Expected field "${key}" to be a ${kind}, got: ${snippet(value)}`);
  }
  return value;
};

/** Reads a required string field; throws descriptively when absent/wrong. */
export const getStringField = (
  record: Record<string, unknown>,
  key: string,
): string => readField(record, key, "string", isString);

/** Reads a required number field; throws descriptively when absent/wrong. */
export const getNumberField = (
  record: Record<string, unknown>,
  key: string,
): number => readField(record, key, "number", isNumber);

/** Reads a required record field; throws descriptively when absent/wrong. */
export const getRecordField = (
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> => readField(record, key, "record", isRecord);

/** Reads a required array field; throws descriptively when absent/wrong. */
export const getArrayField = (
  record: Record<string, unknown>,
  key: string,
): unknown[] => readField(record, key, "array", isArray);

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
