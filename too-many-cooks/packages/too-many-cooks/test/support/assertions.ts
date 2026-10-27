/// Shared assertion helpers for tests ([DEDUP-DESLOP]).
///
/// `assertDefined` narrows away `undefined` (replacing non-null
/// assertions); `expectOk`/`expectErr` collapse the repeated
/// Result check-then-throw boilerplate into one call that keeps
/// the assertion and narrows the type.

import assert from "node:assert";
import type { Err, Success } from "too-many-cooks-core";

/** Asserts a value is defined and narrows away `undefined`. */
export const assertDefined: <T>(
  value: T | undefined,
  message: string,
) => asserts value is T = <T>(
  value: T | undefined,
  message: string,
): asserts value is T => {
  assert.ok(value !== undefined, message);
};

/** Asserts a Result is Ok and returns its value. */
export const expectOk = <T, E>(
  result: Success<T> | Err<E>,
  message: string,
): T => {
  assert.strictEqual(result.ok, true, message);
  if (!result.ok) {
    throw new Error(message);
  }
  return result.value;
};

/** Asserts a Result is Err and returns its error. */
export const expectErr = <T, E>(
  result: Success<T> | Err<E>,
  message: string,
): E => {
  assert.strictEqual(result.ok, false, message);
  if (result.ok) {
    throw new Error(message);
  }
  return result.error;
};

/** Asserts a value is neither null nor undefined and returns it narrowed. */
export const assertNonNullish = <T>(
  value: T | null | undefined,
  message: string,
): T => {
  assert.ok(value !== null && value !== undefined, message);
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
};

/** Asserts `items` has `expected.length` elements whose `field` values
 * equal the expected set (order-insensitive) ([DEDUP-DESLOP]). */
export const assertFieldSetEquals = <T>(
  items: readonly T[],
  field: (item: T) => string,
  expected: readonly string[],
): void => {
  assert.strictEqual(items.length, expected.length);
  assert.deepStrictEqual(
    new Set(items.map(field)),
    new Set(expected),
  );
};

/** Asserts `record[field]` is an array of exactly `count` entries. */
export const assertArrayFieldCount = (
  record: Record<string, unknown>,
  field: string,
  count: number,
): void => {
  const items: unknown = record[field];
  assert.strictEqual(Array.isArray(items), true, `field "${field}" must be an array`);
  if (!Array.isArray(items)) { return; }
  assert.strictEqual(items.length, count);
};
