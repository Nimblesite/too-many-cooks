import type { TooManyCooksDb } from "@too-many-cooks/core";
import type { Keychain, WorkspaceKey } from "./crypto.js";
/** Create an encrypting wrapper around a TooManyCooksDb. */
export declare const withEncryption: (db: TooManyCooksDb, currentKey: WorkspaceKey, keychain: Keychain) => TooManyCooksDb;
//# sourceMappingURL=encryption-middleware.d.ts.map