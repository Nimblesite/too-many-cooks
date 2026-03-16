import { type Logger, type Result, type RetryPolicy, type TooManyCooksDataConfig, type TooManyCooksDb } from "@too-many-cooks/core";
/** Create database instance with retry policy. */
export declare const createDb: (config: TooManyCooksDataConfig, logger?: Logger, retryPolicy?: RetryPolicy) => Result<TooManyCooksDb, string>;
//# sourceMappingURL=db-sqlite.d.ts.map