/// [BACKEND-E2E] src/backend.ts + src/encryption-middleware.ts + crypto
/// round-trips against the in-process fake cloud API. Proves the encrypted
/// cloud path end-to-end through the public createBackend API: secrets the
/// cloud receives are ciphertext, values read back through the db are
/// plaintext, and undecryptable payloads surface as DECRYPTION_FAILED.

import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  type Logger,
  type TooManyCooksDb,
  createDataConfig,
  createLoggingContext,
  createLoggerWithContext,
} from "too-many-cooks-core";

import { createBackend, isCloudMode } from "../src/backend.js";
import { decrypt, encrypt, parseConfig } from "../src/index.js";
import { requireDb } from "./support/db_fixture.js";
import { FakeCloudApi, okEnvelope } from "./support/fake_cloud_api.js";

const API_KEY = "cov-api-key";
const WORKSPACE_ID = "cov-ws";
const SECRET = "cov-workspace-secret";
const OTHER_SECRET = "cov-other-secret";
const LOCK_PATH = "/cov/file.ts";
const LOCK_TIMEOUT_MS = 30000;
const DECRYPT_CODE = "DECRYPTION_FAILED";
const ERR_EMPTY = "Empty ciphertext envelope";
const ERR_WRONG_KEY = "Decryption failed: invalid key or corrupted data";
const ERR_UNKNOWN_VERSION = "Unknown key version: 2";
const UNKNOWN_VERSION_ENVELOPE = Buffer.from([2]).toString("base64");
const TMP_PREFIX = "/tmp/tmc-backend-e2e-";
const UNUSED_DB_PATH = "/unused/data.db";
const SQLITE_MODE_LOG = "info:Backend: SQLite (local mode)";
const CLOUD_MODE_LOG = "info:Backend: Cloud (encrypted)";
const CLOUD_OK = 200;
const MESSAGE_A = "a";
const MESSAGE_B = "b";
const AGENT_KEY = "k";

/** Result shape the decryption-failure assertions inspect. */
type ResultLike = { readonly ok: boolean; readonly error?: unknown };

/** A cloud env block pointing at `url`. */
const cloudEnv = (url: string): Record<string, string> => ({
  TMC_API_KEY: API_KEY,
  TMC_WORKSPACE_ID: WORKSPACE_ID,
  TMC_WORKSPACE_SECRET: SECRET,
  TMC_API_URL: url,
});

/** Logger that records formatted lines for exact assertions. */
type RecordingLogger = Logger & { readonly lines: readonly string[] };

const recordingLogger = (): RecordingLogger => {
  const lines: string[] = [];
  const sink = (level: string): ((message: string) => void) =>
    (message: string): void => { lines.push(`${level}:${message}`); };
  const base: RecordingLogger = {
    lines,
    trace: sink("trace"),
    debug: sink("debug"),
    info: sink("info"),
    warn: sink("warn"),
    error: sink("error"),
    fatal: sink("fatal"),
    child: (): Logger => base,
  };
  return base;
};

const scriptAck = (cloud: FakeCloudApi, endpoint: string): void => {
  cloud.script(endpoint, CLOUD_OK, okEnvelope(null));
};

/** Restore env keys to their prior values, deleting keys that were unset. */
type EnvKey = "TMC_API_KEY" | "TMC_WORKSPACE_ID" | "TMC_WORKSPACE_SECRET" | "TMC_API_URL";

const restoreKey = (key: EnvKey, prior: NodeJS.ProcessEnv): void => {
  const value: string | undefined = prior[key];
  if (value !== undefined) {
    process.env[key] = value;
    return;
  }
  if (key === "TMC_API_KEY") { delete process.env.TMC_API_KEY; }
  else if (key === "TMC_WORKSPACE_ID") { delete process.env.TMC_WORKSPACE_ID; }
  else if (key === "TMC_WORKSPACE_SECRET") { delete process.env.TMC_WORKSPACE_SECRET; }
  else { delete process.env.TMC_API_URL; }
};

const restoreEnv = (prior: NodeJS.ProcessEnv): void => {
  const keys: readonly EnvKey[] = ["TMC_API_KEY", "TMC_WORKSPACE_ID", "TMC_WORKSPACE_SECRET", "TMC_API_URL"];
  for (const key of keys) { restoreKey(key, prior); }
};

/** Boots an encrypted cloud backend against `cloud`, failing when it cannot. */
const cloudBackend = async (cloud: FakeCloudApi): Promise<TooManyCooksDb> => {
  const url = await cloud.start();
  const log = createLoggerWithContext(createLoggingContext());
  const result = createBackend(
    createDataConfig({ dbPath: UNUSED_DB_PATH }),
    log,
    cloudEnv(url),
  );
  assert.strictEqual(result.ok, true, "cloud backend must be created");
  if (!result.ok) { throw new Error("cloud backend failed"); }
  return result.value;
};

/** Closes `db` (acknowledging `close`) and then the fake cloud API. */
const teardownCloud = async (
  cloud: FakeCloudApi,
  db: TooManyCooksDb | undefined,
): Promise<void> => {
  if (db !== undefined) {
    scriptAck(cloud, "close");
    await db.close();
  }
  await cloud.close();
};

/** Parses the cloud config for `secret`; fails the test when parsing fails. */
const cloudConfigFor = (secret: string): ReturnType<typeof parseConfig> => {
  const parsed = parseConfig({
    TMC_API_KEY: API_KEY,
    TMC_WORKSPACE_ID: WORKSPACE_ID,
    TMC_WORKSPACE_SECRET: secret,
  });
  assert.strictEqual(parsed.ok, true, "parseConfig must succeed");
  return parsed;
};

/** Asserts `result` failed with the DECRYPTION_FAILED code and `message`. */
const expectDecryptFailure = (result: ResultLike, message: string): void => {
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.error, { code: DECRYPT_CODE, message });
};

/** Scripts an ack for `endpoint`, runs `call`, asserts Ok, returns the sent body. */
const callAndCaptureBody = async (
  cloud: FakeCloudApi,
  endpoint: string,
  call: () => Promise<ResultLike>,
): Promise<string> => {
  scriptAck(cloud, endpoint);
  assert.strictEqual((await call()).ok, true);
  return JSON.stringify(cloud.last(endpoint).body);
};

describe("backend env selection", () => {
  it("isCloudMode requires a non-empty TMC_API_KEY", () => {
    assert.strictEqual(isCloudMode({}), false);
    assert.strictEqual(isCloudMode({ TMC_API_KEY: "" }), false);
    assert.strictEqual(isCloudMode({ TMC_API_KEY: API_KEY }), true);
  });

  it("createBackend builds SQLite when cloud env is absent or blank", async () => {
    const workspace = mkdtempSync(TMP_PREFIX);
    try {
      let variant = 0;
      for (const env of [{}, { TMC_API_KEY: "" }]) {
        variant += 1;
        const log = recordingLogger();
        const result = createBackend(
          createDataConfig({ dbPath: `${join(workspace, "data.db")}.${String(variant)}` }),
          log,
          env,
        );
        if (!result.ok) { assert.fail(`local backend failed: ${result.error}`); }
        const registered = await result.value.register("sqlite-agent");
        assert.strictEqual(registered.ok, true);
        assert.strictEqual((await result.value.close()).ok, true);
        assert.ok(log.lines.includes(SQLITE_MODE_LOG));
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("createBackend reports the exact missing-env error", () => {
    const result = createBackend(
      createDataConfig({ dbPath: UNUSED_DB_PATH }),
      recordingLogger(),
      { TMC_API_KEY: API_KEY },
    );
    if (result.ok) { assert.fail("expected error"); }
    assert.strictEqual(result.error, "Missing required env var: TMC_WORKSPACE_ID");
  });

  it("createBackend reads process.env when env is omitted", async () => {
    const cloud = new FakeCloudApi();
    const url = await cloud.start();
    const prior = { ...process.env };
    process.env.TMC_API_KEY = API_KEY;
    process.env.TMC_WORKSPACE_ID = WORKSPACE_ID;
    process.env.TMC_WORKSPACE_SECRET = SECRET;
    process.env.TMC_API_URL = url;
    try {
      const log = recordingLogger();
      const result = createBackend(createDataConfig({ dbPath: UNUSED_DB_PATH }), log);
      if (!result.ok) { assert.fail(`cloud backend failed: ${result.error}`); }
      scriptAck(cloud, "close");
      assert.strictEqual((await result.value.close()).ok, true);
      assert.ok(log.lines.includes(CLOUD_MODE_LOG));
    } finally {
      restoreEnv(prior);
      await cloud.close();
    }
  });
});

describe("encrypted cloud backend round-trips", () => {
  const cloud = new FakeCloudApi();
  let db: TooManyCooksDb | undefined;

  before(async () => {
    db = await cloudBackend(cloud);
  });

  after(async () => {
    await teardownCloud(cloud, db);
  });

  it("lock reasons travel encrypted and decrypt on read", async () => {
    const backend = requireDb(db);
    const parsed = cloudConfigFor(SECRET);
    if (!parsed.ok) { assert.fail("parseConfig failed"); }
    scriptAck(cloud, "acquireLock");
    const acquired = await backend.acquireLock(LOCK_PATH, "agent", AGENT_KEY, "my secret reason", LOCK_TIMEOUT_MS);
    assert.strictEqual(acquired.ok, true);
    const raw = cloud.last("acquireLock").body;
    if (typeof raw !== "object" || raw === null || !("reason" in raw)) { assert.fail("no reason sent"); }
    const reason: unknown = raw.reason;
    if (typeof reason !== "string") { assert.fail("reason not a string"); }
    assert.ok(!reason.includes("my secret reason"));
    const recovered = decrypt(reason, parsed.value.keychain);
    if (!recovered.ok) { assert.fail(`decrypt failed: ${recovered.error}`); }
    assert.strictEqual(recovered.value, "my secret reason");
  });

  it("message content and plans travel encrypted", async () => {
    const backend = requireDb(db);
    const body = await callAndCaptureBody(
      cloud,
      "sendMessage",
      async () => await backend.sendMessage(MESSAGE_A, AGENT_KEY, MESSAGE_B, "attack at dawn"),
    );
    assert.ok(!body.includes("attack at dawn"));

    const planBody = await callAndCaptureBody(
      cloud,
      "updatePlan",
      async () => await backend.updatePlan(MESSAGE_A, AGENT_KEY, "secret goal", "secret task"),
    );
    assert.ok(!planBody.includes("secret goal"));
    assert.ok(!planBody.includes("secret task"));
  });

  it("ciphertext written by the db decrypts back through the keychain", async () => {
    const backend = requireDb(db);
    const parsed = cloudConfigFor(SECRET);
    if (!parsed.ok) { assert.fail("parseConfig failed"); }
    const roundTrip = parsed.value.keychain;
    cloud.script("queryLock", CLOUD_OK, okEnvelope({
      file_path: LOCK_PATH, agent_name: "agent", acquired_at: 1, expires_at: 9,
      reason: encrypt("round trip reason", parsed.value.currentKey), version: 1,
    }));
    const lock = await backend.queryLock(LOCK_PATH);
    if (!lock.ok || lock.value === null) { assert.fail("queryLock failed"); }
    assert.strictEqual(lock.value.reason, "round trip reason");
    assert.strictEqual(roundTrip.length, 1);
  });
});

describe("decryption failures surface as DECRYPTION_FAILED", () => {
  const cloud = new FakeCloudApi();
  let db: TooManyCooksDb | undefined;
  let wrongKeyEnvelope: string;

  before(async () => {
    db = await cloudBackend(cloud);
    const parsed = cloudConfigFor(OTHER_SECRET);
    if (!parsed.ok) { assert.fail("parseConfig failed"); }
    wrongKeyEnvelope = encrypt("readable", parsed.value.currentKey);
  });

  after(async () => {
    await teardownCloud(cloud, db);
  });

  /** Scripts `endpoint` with one message row, asserts its decryption fails. */
  const expectMessageRowFailure = async (
    endpoint: string,
    messageId: string,
    call: () => Promise<ResultLike>,
  ): Promise<void> => {
    cloud.script(endpoint, CLOUD_OK, okEnvelope([
      { id: messageId, from_agent: MESSAGE_A, to_agent: MESSAGE_B, content: wrongKeyEnvelope, created_at: 1 },
    ]));
    expectDecryptFailure(await call(), ERR_WRONG_KEY);
  };

  it("fails on message content encrypted with a foreign key", async () => {
    const backend = requireDb(db);
    await expectMessageRowFailure(
      "getMessages",
      "m1",
      async () => await backend.getMessages(MESSAGE_B, AGENT_KEY),
    );
    await expectMessageRowFailure(
      "listAllMessages",
      "m2",
      async () => await backend.listAllMessages(),
    );
  });

  it("fails on empty and unknown-version envelopes in locks", async () => {
    const backend = requireDb(db);
    cloud.script("queryLock", CLOUD_OK, okEnvelope({
      file_path: "/f", agent_name: "a", acquired_at: 1, expires_at: 2, reason: "", version: 1,
    }));
    expectDecryptFailure(await backend.queryLock("/f"), ERR_EMPTY);

    cloud.script("listLocks", CLOUD_OK, okEnvelope([
      { file_path: "/f", agent_name: "a", acquired_at: 1, expires_at: 2, reason: UNKNOWN_VERSION_ENVELOPE, version: 1 },
    ]));
    expectDecryptFailure(await backend.listLocks(), ERR_UNKNOWN_VERSION);
  });

  it("fails on bad plan envelopes and passes db errors through untouched", async () => {
    const backend = requireDb(db);
    cloud.script("getPlan", CLOUD_OK, okEnvelope({ agent_name: "a", goal: "", current_task: "t", updated_at: 1 }));
    expectDecryptFailure(await backend.getPlan("a"), ERR_EMPTY);

    cloud.script("listPlans", CLOUD_OK, okEnvelope([
      { agent_name: "a", goal: UNKNOWN_VERSION_ENVELOPE, current_task: "t", updated_at: 1 },
    ]));
    expectDecryptFailure(await backend.listPlans(), ERR_UNKNOWN_VERSION);

    cloud.script("listPlans", 422, { ok: false, error: { code: "NETWORK_ERROR", message: "down" } });
    const passthrough = await backend.listPlans();
    assert.strictEqual(passthrough.ok, false);
    if (passthrough.ok) { assert.fail("unreachable"); }
    assert.deepStrictEqual(passthrough.error, { code: "NETWORK_ERROR", message: "down" });
  });
});
