/// Cloud proxy configuration from environment variables.

import { type Result, error, success } from "too-many-cooks-core";

import { type Keychain, type WorkspaceKey, deriveWorkspaceKey } from "./crypto.js";

/** Environment variable name for the API key. */
const ENV_API_KEY: string = "TMC_API_KEY";

/** Environment variable name for the workspace ID. */
const ENV_WORKSPACE_ID: string = "TMC_WORKSPACE_ID";

/** Environment variable name for the workspace secret (current). */
const ENV_WORKSPACE_SECRET: string = "TMC_WORKSPACE_SECRET";

/** Environment variable name for the previous workspace secret (rotation). */
const ENV_WORKSPACE_SECRET_V1: string = "TMC_WORKSPACE_SECRET_V1";

/** Environment variable name for the cloud API URL. */
const ENV_API_URL: string = "TMC_API_URL";

/** Error prefix for missing environment variables. */
const ERR_MISSING_ENV: string = "Missing required env var: ";

/** Default production API URL. */
const DEFAULT_API_URL: string = "https://your-project.supabase.co/functions/v1/tmc-api";

/** Required credentials parsed from the environment. */
type RequiredCloudEnv = {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly secret: string;
};

/** Cloud proxy configuration. */
export type CloudProxyConfig = {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly apiUrl: string;
  readonly keychain: Keychain;
  readonly currentKey: WorkspaceKey;
};

/** Build a keychain from current + optional previous passphrase. */
const buildKeychain: (
  currentPassphrase: string,
  workspaceId: string,
  previousPassphrase: string | undefined
) => { readonly keychain: Keychain; readonly currentKey: WorkspaceKey } = (
  currentPassphrase: string,
  workspaceId: string,
  previousPassphrase: string | undefined
): { readonly keychain: Keychain; readonly currentKey: WorkspaceKey } => {
  const currentKey: WorkspaceKey = deriveWorkspaceKey(currentPassphrase, workspaceId);
  const keys: WorkspaceKey[] = [currentKey];
  if (previousPassphrase !== undefined) {
    keys.push({
      ...deriveWorkspaceKey(previousPassphrase, workspaceId),
      version: currentKey.version - 1,
    });
  }
  return { keychain: keys, currentKey };
};

/** Read one required non-empty environment variable. */
const requireEnv: (env: Record<string, string | undefined>, name: string) => Result<string, string> = (
  env: Record<string, string | undefined>,
  name: string
): Result<string, string> => {
  const value: string | undefined = env[name];
  return value !== undefined && value !== "" ? success(value) : error(`${ERR_MISSING_ENV}${name}`);
};

/** Read the three required cloud env vars, or the first missing-var error. */
const requireCloudEnv: (env: Record<string, string | undefined>) => Result<RequiredCloudEnv, string> = (
  env: Record<string, string | undefined>
): Result<RequiredCloudEnv, string> => {
  const apiKey: Result<string, string> = requireEnv(env, ENV_API_KEY);
  if (!apiKey.ok) {
    return apiKey;
  }
  const workspaceId: Result<string, string> = requireEnv(env, ENV_WORKSPACE_ID);
  if (!workspaceId.ok) {
    return workspaceId;
  }
  const secret: Result<string, string> = requireEnv(env, ENV_WORKSPACE_SECRET);
  if (!secret.ok) {
    return secret;
  }
  return success({ apiKey: apiKey.value, workspaceId: workspaceId.value, secret: secret.value });
};

/** Parse and validate cloud proxy config from environment. */
export const parseConfig: (env: Record<string, string | undefined>) => Result<CloudProxyConfig, string> = (
  env: Record<string, string | undefined>
): Result<CloudProxyConfig, string> => {
  const required: Result<RequiredCloudEnv, string> = requireCloudEnv(env);
  if (!required.ok) {
    return required;
  }
  const { apiKey, workspaceId, secret } = required.value;
  const apiUrl: string = env[ENV_API_URL] ?? DEFAULT_API_URL;
  const { keychain, currentKey }: { readonly keychain: Keychain; readonly currentKey: WorkspaceKey } = buildKeychain(
    secret,
    workspaceId,
    env[ENV_WORKSPACE_SECRET_V1]
  );
  return success({ apiKey, workspaceId, apiUrl, keychain, currentKey });
};
