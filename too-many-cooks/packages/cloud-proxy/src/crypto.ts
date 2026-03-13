/// E2E encryption module for TMC Cloud.
///
/// Zero-knowledge architecture: all crypto happens LOCAL, never on server.
/// Uses HKDF-SHA256 for key derivation and AES-256-GCM for encryption.

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { type Result, error, success } from "@too-many-cooks/core";

/** Current key version for new encryptions. */
const CURRENT_KEY_VERSION = 1;

/** AES-256-GCM algorithm identifier. */
const ALGORITHM = "aes-256-gcm";

/** GCM initialization vector length in bytes. */
const IV_LENGTH = 12;

/** GCM authentication tag length in bytes. */
const AUTH_TAG_LENGTH = 16;

/** Version byte length in the ciphertext envelope. */
const VERSION_BYTE_LENGTH = 1;

/** Offset where IV starts in the ciphertext envelope. */
const IV_OFFSET = VERSION_BYTE_LENGTH;

/** Offset where auth tag starts in the ciphertext envelope. */
const AUTH_TAG_OFFSET = IV_OFFSET + IV_LENGTH;

/** Offset where ciphertext starts in the ciphertext envelope. */
const CIPHERTEXT_OFFSET = AUTH_TAG_OFFSET + AUTH_TAG_LENGTH;

/** HKDF hash algorithm. */
const HKDF_HASH = "sha256";

/** HKDF info string for workspace key derivation. */
const HKDF_INFO = "tmc-cloud-workspace-key-v1";

/** Derived key length in bytes (256 bits). */
const HKDF_KEY_LENGTH = 32;

/** Encoding used for plaintext strings. */
const TEXT_ENCODING = "utf8";

/** Encoding used for the ciphertext envelope. */
const ENVELOPE_ENCODING = "base64";

/** Error message for empty ciphertext input. */
const ERR_EMPTY_ENVELOPE = "Empty ciphertext envelope";

/** Error message prefix for unknown key versions. */
const ERR_UNKNOWN_VERSION_PREFIX = "Unknown key version: ";

/** Error message for decryption failure. */
const ERR_DECRYPT_FAILED = "Decryption failed: invalid key or corrupted data";

/** Workspace encryption key with version for key rotation. */
export type WorkspaceKey = {
  readonly version: number;
  readonly key: Buffer;
};

/** Keychain containing one or more workspace keys for decryption. */
export type Keychain = readonly WorkspaceKey[];

/** Derive a workspace key from a passphrase and workspace ID via HKDF. */
export const deriveWorkspaceKey = (
  passphrase: string,
  workspaceId: string,
): WorkspaceKey => {
  const key = hkdfSync(
    HKDF_HASH,
    Buffer.from(passphrase, TEXT_ENCODING),
    Buffer.from(workspaceId, TEXT_ENCODING),
    Buffer.from(HKDF_INFO, TEXT_ENCODING),
    HKDF_KEY_LENGTH,
  );
  return { version: CURRENT_KEY_VERSION, key: Buffer.from(key) };
};

/** Encrypt plaintext to a base64 ciphertext envelope.
 *  Format: [version:1][iv:12][authTag:16][ciphertext:N] */
export const encrypt = (
  plaintext: string,
  wk: WorkspaceKey,
): string => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, wk.key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, TEXT_ENCODING),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const envelope = Buffer.concat([
    Buffer.from([wk.version]),
    iv,
    authTag,
    encrypted,
  ]);
  return envelope.toString(ENVELOPE_ENCODING);
};

/** Decrypt a base64 ciphertext envelope back to plaintext. */
export const decrypt = (
  blob: string,
  keychain: Keychain,
): Result<string, string> => {
  const data = Buffer.from(blob, ENVELOPE_ENCODING);
  const [version] = data;
  if (version === undefined) {
    return error(ERR_EMPTY_ENVELOPE);
  }
  const iv = data.subarray(IV_OFFSET, AUTH_TAG_OFFSET);
  const authTag = data.subarray(AUTH_TAG_OFFSET, CIPHERTEXT_OFFSET);
  const ciphertext = data.subarray(CIPHERTEXT_OFFSET);
  const wk = keychain.find((wkEntry) => {return wkEntry.version === version});
  if (wk === undefined) {
    return error(`${ERR_UNKNOWN_VERSION_PREFIX}${String(version)}`);
  }
  const decipher = createDecipheriv(ALGORITHM, wk.key, iv);
  decipher.setAuthTag(authTag);
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return success(decrypted.toString(TEXT_ENCODING));
  } catch {
    return error(ERR_DECRYPT_FAILED);
  }
};
