/// Backend abstraction — creates a TooManyCooksDb from environment.
///
/// If cloud env vars (TMC_API_KEY, TMC_WORKSPACE_ID, TMC_WORKSPACE_SECRET)
/// are present, creates an encrypted cloud backend. Otherwise, creates SQLite.
/// Tool handlers are identical regardless of backend.

import {
  type Logger,
  type Result,
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
  error,
  success,
} from "@too-many-cooks/core";

import { type CloudProxyConfig, parseConfig } from "./cloud-config.js";
import { createCloudDb } from "./db-cloud.js";
import { createDb } from "./db-sqlite.js";
import { withEncryption } from "./encryption-middleware.js";

/** Read process.env without type assertion. */
const processEnv: () => Record<string, string | undefined> = (): Record<string, string | undefined> => {
  const result: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    result[key] = process.env[key];
  }
  return result;
};

/** Environment variable that signals cloud mode. */
const CLOUD_MODE_ENV_KEY: string = "TMC_API_KEY";

/** Check whether cloud mode env vars are present. */
export const isCloudMode: (
  env: Record<string, string | undefined>,
) => boolean = (env: Record<string, string | undefined>): boolean => {
  const val: string | undefined = env[CLOUD_MODE_ENV_KEY];
  return val !== undefined && val !== "";
};

/** Create a TooManyCooksDb for the active backend (SQLite or cloud). */
export const createBackend: (
  config: TooManyCooksDataConfig,
  log: Logger,
  env?: Record<string, string | undefined>,
) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  log: Logger,
  env?: Record<string, string | undefined>,
): Result<TooManyCooksDb, string> => {
  const resolvedEnv: Record<string, string | undefined> =
    env ?? processEnv();

  return isCloudMode(resolvedEnv)
    ? createCloudBackend(resolvedEnv, log)
    : createLocalBackend(config, log);
};

/** Create a local SQLite backend. */
const createLocalBackend: (
  config: TooManyCooksDataConfig,
  log: Logger,
) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  log: Logger,
): Result<TooManyCooksDb, string> => {
  log.info("Backend: SQLite (local mode)");
  return createDb(config);
};

/** Create an encrypted cloud backend. */
const createCloudBackend: (
  env: Record<string, string | undefined>,
  log: Logger,
) => Result<TooManyCooksDb, string> = (
  env: Record<string, string | undefined>,
  log: Logger,
): Result<TooManyCooksDb, string> => {
  const configResult: Result<CloudProxyConfig, string> = parseConfig(env);
  if (!configResult.ok) { return error(configResult.error); }
  const cfg: CloudProxyConfig = configResult.value;

  log.info("Backend: Cloud (encrypted)", { apiUrl: cfg.apiUrl });

  const rawDb: TooManyCooksDb = createCloudDb(cfg.apiUrl, cfg.apiKey, cfg.workspaceId);
  const db: TooManyCooksDb = withEncryption(rawDb, cfg.currentKey, cfg.keychain);
  return success(db);
};
