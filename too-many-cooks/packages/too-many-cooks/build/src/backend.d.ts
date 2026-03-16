import { type Logger, type Result, type TooManyCooksDataConfig, type TooManyCooksDb } from "@too-many-cooks/core";
/** Check whether cloud mode env vars are present. */
export declare const isCloudMode: (env: Record<string, string | undefined>) => boolean;
/** Create a TooManyCooksDb for the active backend (SQLite or cloud). */
export declare const createBackend: (config: TooManyCooksDataConfig, log: Logger, env?: Record<string, string | undefined>) => Result<TooManyCooksDb, string>;
//# sourceMappingURL=backend.d.ts.map