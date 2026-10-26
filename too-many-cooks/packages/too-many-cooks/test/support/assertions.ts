/// Shared assertion helpers for tests ([DEDUP-DESLOP]).
///
/// `assertDefined` narrows away `undefined` (replacing non-null
/// assertions); `expectOk`/`expectErr` collapse the repeated
/// Result check-then-throw boilerplate into one call that keeps
/// the assertion and narrows the type.

import assert from "node:assert";

/** Minimal structural shapes of a neverthrow-style Result. */
type OkResult<T> = { readonly ok: true; readonly value: T };
type ErrResult<E> = { readonly ok: false; readonly error: E };

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
  result: OkResult<T> | ErrResult<E>,
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
  result: OkResult<T> | ErrResult<E>,
  message: string,
): E => {
  assert.strictEqual(result.ok, false, message);
  if (result.ok) {
    throw new Error(message);
  }
  return result.error;
};
