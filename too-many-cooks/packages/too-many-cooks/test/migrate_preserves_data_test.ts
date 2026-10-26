/// [DB-MIGRATE] Re-opening a populated, up-to-date database must be a no-op
/// migration: DataProviderMigrate diffs the live schema against the YAML and,
/// finding nothing to change, leaves every row in place. A nuke-and-recreate
/// strategy would wipe the registered agent and its message and fail here.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";

import { createDataConfig } from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";
import { deleteIfExists } from "./support/fs_helpers.js";

const TEST_DB_PATH: string = ".test_migrate_preserves_data.db";
const SENDER: string = "keeper-sender";
const RECIPIENT: string = "keeper-recipient";
const CONTENT: string = "this row must survive a re-migration";

describe("re-migrating a populated DB preserves data", () => {
  afterEach(() => {
    deleteIfExists(TEST_DB_PATH);
  });

  it("agents and messages survive closing and re-opening through createDb", async () => {
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const first = createDb(config);
    assert.strictEqual(first.ok, true, `first open must succeed, got: ${first.ok ? "" : first.error}`);
    if (!first.ok) { return; }

    const sender = await first.value.register(SENDER);
    const recipient = await first.value.register(RECIPIENT);
    assert.strictEqual(sender.ok, true);
    assert.strictEqual(recipient.ok, true);
    if (!sender.ok || !recipient.ok) { return; }
    const sent = await first.value.sendMessage(SENDER, sender.value.agentKey, RECIPIENT, CONTENT);
    assert.strictEqual(sent.ok, true, `sendMessage must succeed, got: ${sent.ok ? "" : sent.error.message}`);
    await first.value.close();

    const second = createDb(config);
    assert.strictEqual(second.ok, true, `re-open must succeed, got: ${second.ok ? "" : second.error}`);
    if (!second.ok) { return; }

    const inbox = await second.value.getMessages(RECIPIENT, recipient.value.agentKey);
    assert.strictEqual(inbox.ok, true);
    if (!inbox.ok) { return; }
    assert.deepStrictEqual(
      inbox.value.map((m) => m.content),
      [CONTENT],
      "the message written before re-migration must still be there",
    );
    await second.value.close();
  });
});
