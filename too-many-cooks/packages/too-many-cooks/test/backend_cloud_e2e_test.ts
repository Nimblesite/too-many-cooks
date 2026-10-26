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
const SQLITE_MODE_LOG = "info:Backend: SQLite (local mode)";
const CLOUD_MODE_LOG = "info:Backend: Cloud (encrypted)";

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
  cloud.script(endpoint, 200, okEnvelope(null));
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
      createDataConfig({ dbPath: "/unused/data.db" }),
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
      const result = createBackend(createDataConfig({ dbPath: "/unused/data.db" }), log);
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
    const url = await cloud.start();
    const log = createLoggerWithContext(createLoggingContext());
    const result = createBackend(
      createDataConfig({ dbPath: "/unused/data.db" }),
      log,
      { TMC_API_KEY: API_KEY, TMC_WORKSPACE_ID: WORKSPACE_ID, TMC_WORKSPACE_SECRET: SECRET, TMC_API_URL: url },
    );
    if (!result.ok) { assert.fail(`cloud backend failed: ${result.error}`); }
    db = result.value;
  });

  after(async () => {
    if (db !== undefined) {
      scriptAck(cloud, "close");
      await db.close();
    }
    await cloud.close();
  });

  it("lock reasons travel encrypted and decrypt on read", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    const parsed = parseConfig({
      TMC_API_KEY: API_KEY, TMC_WORKSPACE_ID: WORKSPACE_ID, TMC_WORKSPACE_SECRET: SECRET,
    });
    if (!parsed.ok) { assert.fail("parseConfig failed"); }
    scriptAck(cloud, "acquireLock");
    const acquired = await db.acquireLock(LOCK_PATH, "agent", "k", "my secret reason", LOCK_TIMEOUT_MS);
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
    if (db === undefined) { assert.fail("db not created"); }
    scriptAck(cloud, "sendMessage");
    const sent = await db.sendMessage("a", "k", "b", "attack at dawn");
    assert.strictEqual(sent.ok, true);
    const body = JSON.stringify(cloud.last("sendMessage").body);
    assert.ok(!body.includes("attack at dawn"));

    scriptAck(cloud, "updatePlan");
    const plan = await db.updatePlan("a", "k", "secret goal", "secret task");
    assert.strictEqual(plan.ok, true);
    const planBody = JSON.stringify(cloud.last("updatePlan").body);
    assert.ok(!planBody.includes("secret goal"));
    assert.ok(!planBody.includes("secret task"));
  });

  it("ciphertext written by the db decrypts back through the keychain", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    const parsed = parseConfig({
      TMC_API_KEY: API_KEY, TMC_WORKSPACE_ID: WORKSPACE_ID, TMC_WORKSPACE_SECRET: SECRET,
    });
    if (!parsed.ok) { assert.fail("parseConfig failed"); }
    const roundTrip = parsed.value.keychain;
    cloud.script("queryLock", 200, okEnvelope({
      file_path: LOCK_PATH, agent_name: "agent", acquired_at: 1, expires_at: 9,
      reason: encrypt("round trip reason", parsed.value.currentKey), version: 1,
    }));
    const lock = await db.queryLock(LOCK_PATH);
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
    const url = await cloud.start();
    const log = createLoggerWithContext(createLoggingContext());
    const result = createBackend(
      createDataConfig({ dbPath: "/unused/data.db" }),
      log,
      { TMC_API_KEY: API_KEY, TMC_WORKSPACE_ID: WORKSPACE_ID, TMC_WORKSPACE_SECRET: SECRET, TMC_API_URL: url },
    );
    if (!result.ok) { assert.fail("cloud backend failed"); }
    db = result.value;
    const parsed = parseConfig({
      TMC_API_KEY: API_KEY, TMC_WORKSPACE_ID: WORKSPACE_ID, TMC_WORKSPACE_SECRET: OTHER_SECRET,
    });
    if (!parsed.ok) { assert.fail("parseConfig failed"); }
    wrongKeyEnvelope = encrypt("readable", parsed.value.currentKey);
  });

  after(async () => {
    if (db !== undefined) {
      scriptAck(cloud, "close");
      await db.close();
    }
    await cloud.close();
  });

  const expectDecryptFailure = (
    result: { ok: boolean; error?: unknown },
    message: string,
  ): void => {
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.error, { code: DECRYPT_CODE, message });
  };

  it("fails on message content encrypted with a foreign key", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("getMessages", 200, okEnvelope([
      { id: "m1", from_agent: "a", to_agent: "b", content: wrongKeyEnvelope, created_at: 1 },
    ]));
    expectDecryptFailure(await db.getMessages("b", "k"), ERR_WRONG_KEY);

    cloud.script("listAllMessages", 200, okEnvelope([
      { id: "m2", from_agent: "a", to_agent: "b", content: wrongKeyEnvelope, created_at: 1 },
    ]));
    expectDecryptFailure(await db.listAllMessages(), ERR_WRONG_KEY);
  });

  it("fails on empty and unknown-version envelopes in locks", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("queryLock", 200, okEnvelope({
      file_path: "/f", agent_name: "a", acquired_at: 1, expires_at: 2, reason: "", version: 1,
    }));
    expectDecryptFailure(await db.queryLock("/f"), ERR_EMPTY);

    cloud.script("listLocks", 200, okEnvelope([
      { file_path: "/f", agent_name: "a", acquired_at: 1, expires_at: 2, reason: UNKNOWN_VERSION_ENVELOPE, version: 1 },
    ]));
    expectDecryptFailure(await db.listLocks(), ERR_UNKNOWN_VERSION);
  });

  it("fails on bad plan envelopes and passes db errors through untouched", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("getPlan", 200, okEnvelope({ agent_name: "a", goal: "", current_task: "t", updated_at: 1 }));
    expectDecryptFailure(await db.getPlan("a"), ERR_EMPTY);

    cloud.script("listPlans", 200, okEnvelope([
      { agent_name: "a", goal: UNKNOWN_VERSION_ENVELOPE, current_task: "t", updated_at: 1 },
    ]));
    expectDecryptFailure(await db.listPlans(), ERR_UNKNOWN_VERSION);

    cloud.script("listPlans", 422, { ok: false, error: { code: "NETWORK_ERROR", message: "down" } });
    const passthrough = await db.listPlans();
    assert.strictEqual(passthrough.ok, false);
    if (passthrough.ok) { assert.fail("unreachable"); }
    assert.deepStrictEqual(passthrough.error, { code: "NETWORK_ERROR", message: "down" });
  });
});
