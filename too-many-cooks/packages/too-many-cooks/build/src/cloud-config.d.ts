import { type Result } from "too-many-cooks-core";
import { type Keychain, type WorkspaceKey } from "./crypto.js";
/** Cloud proxy configuration. */
export type CloudProxyConfig = {
    readonly apiKey: string;
    readonly workspaceId: string;
    readonly apiUrl: string;
    readonly keychain: Keychain;
    readonly currentKey: WorkspaceKey;
};
/** Parse and validate cloud proxy config from environment. */
export declare const parseConfig: (env: Record<string, string | undefined>) => Result<CloudProxyConfig, string>;
//# sourceMappingURL=cloud-config.d.ts.map