/// [MSG-PRIVACY] Issue #11: the `status` tool must NOT leak direct messages
/// addressed to other agents. An agent calling `status` may only see
/// broadcasts (to_agent = "*") plus its own inbox/sent messages.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  type TooManyCooksDb,
  createStatusHandler,
} from "too-many-cooks-core";
import { bindTestDb } from "./support/db_fixture.js";
import {
  createTestLogger,
  type MessagesOverview,
  statusMessagesOverview,
} from "./support/handlers.js";

const TEST_DB_PATH = ".test_status_message_privacy.db";
const BROADCAST = "*";

const statusOverviewFor = async (
  db: TooManyCooksDb,
  agentKey: string,
): Promise<MessagesOverview> => {
  const handler = createStatusHandler(db, createTestLogger());
  const result = await handler({ agent_key: agentKey }, {});
  assert.strictEqual(result.isError, false, "status must not error");
  return statusMessagesOverview(result);
};

describe("status tool message privacy (#11)", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("does not expose a direct message between two other agents to a third agent", async () => {
    const db = testDb.db();
    const alice = await db.register("privacy-alice");
    const bob = await db.register("privacy-bob");
    const carol = await db.register("privacy-carol");
    if (!alice.ok || !bob.ok || !carol.ok) { throw new Error("expected registrations ok"); }

    const secret = "secret-for-bob-only";
    const sent = await db.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, secret);
    assert.strictEqual(sent.ok, true, "direct send must succeed");

    const carolOverview = await statusOverviewFor(db, carol.value.agentKey);
    assert.strictEqual(carolOverview.total, 0, "Carol's overview must count zero visible messages");
    assert.strictEqual(
      carolOverview.recent.some((m) => m.from_agent === alice.value.agentName && m.to_agent === bob.value.agentName),
      false,
      "Carol must NOT see a direct message addressed to Bob",
    );
  });

  it("still shows the recipient their own direct message and broadcasts to everyone", async () => {
    const db = testDb.db();
    const alice = await db.register("privacy-alice2");
    const bob = await db.register("privacy-bob2");
    const carol = await db.register("privacy-carol2");
    if (!alice.ok || !bob.ok || !carol.ok) { throw new Error("expected registrations ok"); }

    await db.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, "direct-to-bob");
    await db.sendMessage(alice.value.agentName, alice.value.agentKey, BROADCAST, "hello-everyone");

    const bobOverview = await statusOverviewFor(db, bob.value.agentKey);
    assert.strictEqual(
      bobOverview.recent.some((m) => m.to_agent === bob.value.agentName),
      true,
      "Bob must see his own direct message header",
    );
    assert.strictEqual(
      bobOverview.recent.some((m) => m.to_agent === BROADCAST),
      true,
      "Bob must see the broadcast header",
    );

    const carolOverview = await statusOverviewFor(db, carol.value.agentKey);
    assert.strictEqual(
      carolOverview.recent.some((m) => m.to_agent === bob.value.agentName),
      false,
      "Carol must NOT see Bob's direct message",
    );
    assert.strictEqual(
      carolOverview.recent.some((m) => m.to_agent === BROADCAST),
      true,
      "Carol must see the broadcast header",
    );
  });
});
