import { type Result } from "@too-many-cooks/core";
/** Workspace encryption key with version for key rotation. */
export type WorkspaceKey = {
    readonly version: number;
    readonly key: Buffer;
};
/** Keychain containing one or more workspace keys for decryption. */
export type Keychain = readonly WorkspaceKey[];
/** Derive a workspace key from a passphrase and workspace ID via HKDF. */
export declare const deriveWorkspaceKey: (passphrase: string, workspaceId: string) => WorkspaceKey;
/** Encrypt plaintext to a base64 ciphertext envelope.
 *  Format: [version:1][iv:12][authTag:16][ciphertext:N] */
export declare const encrypt: (plaintext: string, wk: WorkspaceKey) => string;
/** Decrypt a base64 ciphertext envelope back to plaintext. */
export declare const decrypt: (blob: string, keychain: Keychain) => Result<string, string>;
//# sourceMappingURL=crypto.d.ts.map