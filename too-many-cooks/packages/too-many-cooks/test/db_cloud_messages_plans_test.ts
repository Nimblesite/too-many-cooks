/// [CLOUD-API-CONTRACT] Message, plan and admin endpoints of src/db-cloud.ts,
/// plus the error-envelope and malformed-payload paths — driven black-box
/// against the in-process fake cloud API (test/support/fake_cloud_api.ts).

import { describe, it } from "node:test";
import assert from "node:assert";

import { errEnvelope, okEnvelope } from "./support/fake_cloud_api.js";
import { bindCloudContract } from "./support/cloud_contract.js";

const ERR_CODE = "VALIDATION_ERROR";
const ERR_MSG = "nope";
const NETWORK_CODE = "NETWORK_ERROR";
const UNKNOWN_MSG = "Unknown API error";
const OVERVIEW_LIMIT = 5;

/** Fake cloud API, db-under-test and transport assertion ([CLOUD-API-CONTRACT]). */
const contract = bindCloudContract();
const { cloud, assertTransport } = contract;

describe("db-cloud message endpoint contract", () => {
  it("sendMessage returns id; non-string value maps to empty string", async () => {
    const db = contract.db();
    cloud.script("sendMessage", 200, okEnvelope("mid-1"));
    const result = await db.sendMessage("a", "k", "b", "hi");
    if (!result.ok) { assert.fail("sendMessage failed"); }
    assert.strictEqual(result.value, "mid-1");
    assertTransport("sendMessage", { fromAgent: "a", fromKey: "k", toAgent: "b", content: "hi" });

    cloud.script("sendMessage", 200, okEnvelope({ id: "mid-1" }));
    const fallback = await db.sendMessage("a", "k", "b", "hi");
    if (!fallback.ok) { assert.fail("sendMessage fallback failed"); }
    assert.strictEqual(fallback.value, "");
  });

  it("getMessages forwards the unreadOnly option and maps message records", async () => {
    const db = contract.db();
    cloud.script("getMessages", 200, okEnvelope([
      { id: "m1", from_agent: "a", to_agent: "b", content: "hello", created_at: 9 },
      { id: "m2", from_agent: "c", to_agent: "b", content: "again", created_at: 10, read_at: 11 },
    ]));
    const result = await db.getMessages("b", "k", { unreadOnly: true });
    if (!result.ok) { assert.fail("getMessages failed"); }
    assert.deepStrictEqual(result.value, [
      { id: "m1", fromAgent: "a", toAgent: "b", content: "hello", createdAt: 9, readAt: undefined },
      { id: "m2", fromAgent: "c", toAgent: "b", content: "again", createdAt: 10, readAt: 11 },
    ]);
    assertTransport("getMessages", { agentName: "b", agentKey: "k", unreadOnly: true });

    cloud.script("getMessages", 200, okEnvelope(null));
    const noOpts = await db.getMessages("b", "k");
    if (!noOpts.ok) { assert.fail("getMessages no-opts failed"); }
    assert.deepStrictEqual(noOpts.value, []);
    assertTransport("getMessages", { agentName: "b", agentKey: "k" });
  });

  it("getMessageOverview maps total/unread/recent headers", async () => {
    const db = contract.db();
    cloud.script("getMessageOverview", 200, okEnvelope({
      total: 3,
      unread: 1,
      recent: [{ id: "m1", from_agent: "a", to_agent: "*", created_at: 4, read_at: 5 }],
    }));
    const result = await db.getMessageOverview("a", OVERVIEW_LIMIT);
    if (!result.ok) { assert.fail("getMessageOverview failed"); }
    assert.deepStrictEqual(result.value, {
      total: 3,
      unread: 1,
      recent: [{ id: "m1", fromAgent: "a", toAgent: "*", createdAt: 4, readAt: 5 }],
    });
    assertTransport("getMessageOverview", { agentName: "a", limit: OVERVIEW_LIMIT });
  });

  it("markRead and listAllMessages hit their endpoints", async () => {
    const db = contract.db();
    cloud.script("markRead", 200, okEnvelope(null));
    const marked = await db.markRead("m1", "b", "k");
    assert.strictEqual(marked.ok, true);
    assertTransport("markRead", { messageId: "m1", agentName: "b", agentKey: "k" });

    cloud.script("listAllMessages", 200, okEnvelope([{ id: "m9", from_agent: "x", to_agent: "y", content: "body", created_at: 1 }]));
    const all = await db.listAllMessages();
    if (!all.ok) { assert.fail("listAllMessages failed"); }
    const firstMessage = all.value[0];
    if (firstMessage === undefined) { assert.fail("no messages returned"); }
    assert.strictEqual(firstMessage.content, "body");
    assertTransport("listAllMessages", {});
  });
});

describe("db-cloud plan and admin endpoint contract", () => {
  it("updatePlan posts exact args; getPlan maps null and records", async () => {
    const db = contract.db();
    cloud.script("updatePlan", 200, okEnvelope(null));
    const updated = await db.updatePlan("a", "k", "goal", "task");
    assert.strictEqual(updated.ok, true);
    assertTransport("updatePlan", { agentName: "a", agentKey: "k", goal: "goal", currentTask: "task" });

    cloud.script("getPlan", 200, okEnvelope(null));
    const none = await db.getPlan("a");
    if (!none.ok) { assert.fail("getPlan null failed"); }
    assert.strictEqual(none.value, null);
    assertTransport("getPlan", { agentName: "a" });

    cloud.script("getPlan", 200, okEnvelope({ agent_name: "a", goal: "g", current_task: "t", updated_at: 8 }));
    const plan = await db.getPlan("a");
    if (!plan.ok) { assert.fail("getPlan record failed"); }
    assert.deepStrictEqual(plan.value, { agentName: "a", goal: "g", currentTask: "t", updatedAt: 8 });

    cloud.script("listPlans", 200, okEnvelope([{ agent_name: "a", goal: "g", current_task: "t", updated_at: 8 }]));
    const plans = await db.listPlans();
    if (!plans.ok) { assert.fail("listPlans failed"); }
    assert.strictEqual(plans.value.length, 1);
    const firstPlan = plans.value[0];
    if (firstPlan === undefined) { assert.fail("no plans returned"); }
    assert.strictEqual(firstPlan.goal, "g");
    assertTransport("listPlans", {});
  });

  it("admin endpoints post exact args and parse values", async () => {
    const db = contract.db();
    cloud.script("adminDeleteLock", 200, okEnvelope(null));
    assert.strictEqual((await db.adminDeleteLock("/x")).ok, true);
    assertTransport("adminDeleteLock", { filePath: "/x" });

    cloud.script("adminDeleteAgent", 200, okEnvelope(null));
    assert.strictEqual((await db.adminDeleteAgent("a")).ok, true);
    assertTransport("adminDeleteAgent", { agentName: "a" });

    cloud.script("adminResetKey", 200, okEnvelope({ agent_name: "a", agent_key: "k2" }));
    const resetKey = await db.adminResetKey("a");
    if (!resetKey.ok) { assert.fail("adminResetKey failed"); }
    assert.deepStrictEqual(resetKey.value, { agentName: "a", agentKey: "k2" });
    assertTransport("adminResetKey", { agentName: "a" });

    cloud.script("adminSendMessage", 200, okEnvelope("m-admin"));
    const sent = await db.adminSendMessage("sys", "a", "hello");
    if (!sent.ok) { assert.fail("adminSendMessage failed"); }
    assert.strictEqual(sent.value, "m-admin");
    assertTransport("adminSendMessage", { fromAgent: "sys", toAgent: "a", content: "hello" });

    cloud.script("adminReset", 200, okEnvelope(null));
    assert.strictEqual((await db.adminReset()).ok, true);
    assertTransport("adminReset", {});
  });
});

describe("db-cloud error envelope handling", () => {
  it("propagates the exact DbError code and message", async () => {
    const db = contract.db();
    cloud.script("register", 422, errEnvelope(ERR_CODE, ERR_MSG));
    const result = await db.register("dup");
    if (result.ok) { assert.fail("expected error"); }
    assert.deepStrictEqual(result.error, { code: ERR_CODE, message: ERR_MSG });
  });

  it("falls back to NETWORK_ERROR/Unknown API error without an error object", async () => {
    const db = contract.db();
    cloud.script("register", 200, { ok: false });
    const result = await db.register("dup");
    if (result.ok) { assert.fail("expected error"); }
    assert.deepStrictEqual(result.error, { code: NETWORK_CODE, message: UNKNOWN_MSG });
  });

  it("rejects non-envelope JSON payloads with the network fallback", async () => {
    const db = contract.db();
    cloud.script("listAgents", 200, ["not", "an", "envelope"]);
    const result = await db.listAgents();
    if (result.ok) { assert.fail("expected error"); }
    assert.deepStrictEqual(result.error, { code: NETWORK_CODE, message: UNKNOWN_MSG });
  });

  it("maps non-record values through empty-record defaults", async () => {
    const db = contract.db();
    cloud.script("register", 200, okEnvelope("scalar"));
    const reg = await db.register("x");
    if (!reg.ok) { assert.fail("register scalar failed"); }
    assert.deepStrictEqual(reg.value, { agentName: "", agentKey: "" });

    cloud.script("getPlan", 200, okEnvelope(undefined));
    const plan = await db.getPlan("x");
    if (!plan.ok) { assert.fail("getPlan undefined failed"); }
    assert.strictEqual(plan.value, null);

    cloud.script("listPlans", 200, okEnvelope([
      { agent_name: "ok", goal: "g", current_task: "t", updated_at: 1 },
      7,
    ]));
    const plans = await db.listPlans();
    if (!plans.ok) { assert.fail("listPlans mixed failed"); }
    assert.strictEqual(plans.value.length, 2);
    const secondPlan = plans.value[1];
    if (secondPlan === undefined) { assert.fail("expected two plans"); }
    assert.deepStrictEqual(secondPlan, { agentName: "", goal: "", currentTask: "", updatedAt: 0 });
  });
});
