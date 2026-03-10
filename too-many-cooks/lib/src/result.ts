/// Result type - replaces nadz package.

/** Success variant of Result. */
export type Success<T> = { readonly ok: true; readonly value: T };

/** Error variant of Result. */
export type Err<E> = { readonly ok: false; readonly error: E };

/** Discriminated union Result type. */
export type Result<T, E> = Success<T> | Err<E>;

/** Create a Success result. */
export const success = <T, E = never>(value: T): Result<T, E> => ({
  ok: true,
  value,
});

/** Create an Error result. */
export const error = <T = never, E = string>(err: E): Result<T, E> => ({
  ok: false,
  error: err,
});

/** Retry policy configuration. */
export type RetryPolicy = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
};

/** Default retry policy. */
export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
};

/** Execute an operation with retry logic. */
export const withRetry = <T>(
  policy: RetryPolicy,
  isRetryable: (error: string) => boolean,
  operation: () => Result<T, string>,
  onRetry?: (attempt: number, error: string, delayMs: number) => void,
): Result<T, string> => {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const result = operation();
    if (result.ok) {return result;}
    if (attempt >= policy.maxAttempts || !isRetryable(result.error)) {
      return result;
    }
    const delayMs = policy.baseDelayMs * attempt;
    onRetry?.(attempt, result.error, delayMs);
    // Synchronous retry - sleep not needed for SQLite retries
  }
  return error("Max retries exceeded");
};
