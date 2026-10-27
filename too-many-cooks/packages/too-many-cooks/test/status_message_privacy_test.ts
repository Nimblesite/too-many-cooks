/// [MSG-PRIVACY] Issue #11: the `status` tool must NOT leak direct messages
/// addressed to other agents. An agent calling `status` may only see
/// broadcasts (to_agent = "*") plus its own inbox/sent messages.

import { describe, it } from "node:test";
import assert from "node:assert";
import { bindTestDb, registerAgent } from "./support/db_fixture.js";
import { type MessagesOverview, statusOverviewFor } from "./support/handlers.js";

const TEST_DB_PATH = ".test_status_message_privacy.db";
const BROADCAST = "*";

/** True when `overview` has a recent header whose `field` equals `value`. */
const recentHas = (
  overview: MessagesOverview,
  field: string,
  value: string,
): boolean => overview.recent.some((m) => m[field] === value);

/** One expectation about a `to_agent` header in an agent's recent slice. */
type RecentCase = {
  readonly subject: string;
  readonly expected: boolean;
  readonly message: string;
};

/** Asserts every case against `overview`'s recent `to_agent` headers. */
const assertRecentToAgent = (
  overview: MessagesOverview,
  cases: readonly RecentCase[],
): void => {
  for (const testCase of cases) {
    assert.strictEqual(
      recentHas(overview, "to_agent", testCase.subject),
      testCase.expected,
      testCase.message,
    );
  }
};

describe("status tool message privacy (#11)", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("does not expose a direct message between two other agents to a third agent", async () => {
    const db = testDb.db();
    const alice = await registerAgent(db, "privacy-alice");
    const bob = await registerAgent(db, "privacy-bob");
    const carol = await registerAgent(db, "privacy-carol");

    const secret = "secret-for-bob-only";
    const sent = await db.sendMessage(alice.agentName, alice.agentKey, bob.agentName, secret);
    assert.strictEqual(sent.ok, true, "direct send must succeed");

    const carolOverview = await statusOverviewFor(db, carol.agentKey);
    assert.strictEqual(carolOverview.total, 0, "Carol's overview must count zero visible messages");
    assert.strictEqual(
      carolOverview.recent.some((m) => m.from_agent === alice.agentName && m.to_agent === bob.agentName),
      false,
      "Carol must NOT see a direct message addressed to Bob",
    );
  });

  it("still shows the recipient their own direct message and broadcasts to everyone", async () => {
    const db = testDb.db();
    const alice = await registerAgent(db, "privacy-alice2");
    const bob = await registerAgent(db, "privacy-bob2");
    const carol = await registerAgent(db, "privacy-carol2");

    await db.sendMessage(alice.agentName, alice.agentKey, bob.agentName, "direct-to-bob");
    await db.sendMessage(alice.agentName, alice.agentKey, BROADCAST, "hello-everyone");

    assertRecentToAgent(await statusOverviewFor(db, bob.agentKey), [
      { subject: bob.agentName, expected: true, message: "Bob must see his own direct message header" },
      { subject: BROADCAST, expected: true, message: "Bob must see the broadcast header" },
    ]);
    assertRecentToAgent(await statusOverviewFor(db, carol.agentKey), [
      { subject: bob.agentName, expected: false, message: "Carol must NOT see Bob's direct message" },
      { subject: BROADCAST, expected: true, message: "Carol must see the broadcast header" },
    ]);
  });
});
