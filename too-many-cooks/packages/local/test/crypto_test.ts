/// Integration tests for the E2E encryption module.

import { strict as assert } from "node:assert";
import test from "node:test";

import { decrypt, deriveWorkspaceKey, encrypt } from "../src/crypto.js";

/** Test passphrase for key derivation. */
const TEST_PASSPHRASE = "my-secure-passphrase";

/** Test workspace ID (UUID format). */
const TEST_WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

/** Alternative passphrase for cross-key tests. */
const ALT_PASSPHRASE = "different-passphrase";

/** Sample plaintext for encryption tests. */
const SAMPLE_PLAINTEXT = "implement the auth module";

/** Empty string for edge case testing. */
const EMPTY_STRING = "";

/** Expected key version for freshly derived keys. */
const EXPECTED_KEY_VERSION = 1;

/** Expected derived key length in bytes (256 bits). */
const EXPECTED_KEY_LENGTH = 32;

test("deriveWorkspaceKey produces deterministic 256-bit key", () => {
  const wk1 = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const wk2 = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  assert.equal(wk1.version, EXPECTED_KEY_VERSION);
  assert.equal(wk1.key.length, EXPECTED_KEY_LENGTH);
  assert.deepEqual(wk1.key, wk2.key);
});

test("different passphrase produces different key", () => {
  const wk1 = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const wk2 = deriveWorkspaceKey(ALT_PASSPHRASE, TEST_WORKSPACE_ID);
  assert.notDeepEqual(wk1.key, wk2.key);
});

test("different workspace ID produces different key", () => {
  const altWorkspaceId = "00000000-0000-0000-0000-000000000001";
  const wk1 = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const wk2 = deriveWorkspaceKey(TEST_PASSPHRASE, altWorkspaceId);
  assert.notDeepEqual(wk1.key, wk2.key);
});

test("encrypt then decrypt round-trips correctly", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(SAMPLE_PLAINTEXT, wk);
  const result = decrypt(ciphertext, [wk]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, SAMPLE_PLAINTEXT);
  }
});

test("encrypt produces base64 output", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(SAMPLE_PLAINTEXT, wk);
  const base64Regex = /^[A-Za-z0-9+/]+=*$/u;
  assert.match(ciphertext, base64Regex);
});

test("encrypt produces different ciphertext each time (random IV)", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ct1 = encrypt(SAMPLE_PLAINTEXT, wk);
  const ct2 = encrypt(SAMPLE_PLAINTEXT, wk);
  assert.notEqual(ct1, ct2);
});

test("decrypt with wrong key returns error", () => {
  const wk1 = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const wk2 = deriveWorkspaceKey(ALT_PASSPHRASE, TEST_WORKSPACE_ID);
  const wrongKeychain = [{ ...wk2, version: wk1.version }];
  const ciphertext = encrypt(SAMPLE_PLAINTEXT, wk1);
  const result = decrypt(ciphertext, wrongKeychain);
  assert.equal(result.ok, false);
});

test("decrypt with unknown key version returns error", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(SAMPLE_PLAINTEXT, wk);
  const emptyKeychain: typeof wk[] = [];
  const result = decrypt(ciphertext, emptyKeychain);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unknown key version/u);
  }
});

test("decrypt empty string returns error", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const result = decrypt(EMPTY_STRING, [wk]);
  assert.equal(result.ok, false);
});

test("encrypt and decrypt empty plaintext", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(EMPTY_STRING, wk);
  const result = decrypt(ciphertext, [wk]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, EMPTY_STRING);
  }
});

test("encrypt and decrypt unicode content", () => {
  const unicode = "Hello World! Encryption test.";
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(unicode, wk);
  const result = decrypt(ciphertext, [wk]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, unicode);
  }
});

test("keychain with multiple versions decrypts old ciphertext", () => {
  const wk1 = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(SAMPLE_PLAINTEXT, wk1);
  const wk2 = {
    ...deriveWorkspaceKey(ALT_PASSPHRASE, TEST_WORKSPACE_ID),
    version: 2,
  };
  const keychain = [wk2, wk1];
  const result = decrypt(ciphertext, keychain);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, SAMPLE_PLAINTEXT);
  }
});

test("corrupted ciphertext returns decryption error", () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const ciphertext = encrypt(SAMPLE_PLAINTEXT, wk);
  const corrupted = Buffer.from(ciphertext, "base64");
  const lastIndex = corrupted.length - 1;
  const lastByte = corrupted[lastIndex];
  if (lastByte !== undefined) {
    // eslint-disable-next-line no-bitwise -- XOR is legitimately needed for crypto corruption test
    corrupted[lastIndex] = lastByte ^ 0xff;
  }
  const result = decrypt(corrupted.toString("base64"), [wk]);
  assert.equal(result.ok, false);
});
