/// [CLOUD-API-CONTRACT] Message, plan and admin endpoints of src/db-cloud.ts,
/// plus the error-envelope and malformed-payload paths — driven black-box
/// against the in-process fake cloud API (test/support/fake_cloud_api.ts).

import { describe, it } from "node:test";
import assert from "node:assert";

import { errEnvelope } from "./support/fake_cloud_api.js";
import {
  type CloudContract,
  bindCloudContract,
  expectErrEnvelope,
  requireIndex,
  scriptedOk,
  scriptedVoid,
} from "./support/cloud_contract.js";

const ERR_CODE = "VALIDATION_ERROR";
const ERR_MSG = "nope";
const NETWORK_CODE = "NETWORK_ERROR";
const UNKNOWN_MSG = "Unknown API error";
const OVERVIEW_LIMIT = 5;

/** Fake cloud API, db-under-test and transport assertion ([CLOUD-API-CONTRACT]). */
const contract: CloudContract = bindCloudContract();
const { assertTransport } = contract;

describe("db-cloud message endpoint contract", () => {
  it("sendMessage returns id; non-string value maps to empty string", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "sendMessage",
      "mid-1",
      async () => await db.sendMessage("a", "k", "b", "hi"),
      "sendMessage failed",
    );
    assert.strictEqual(value, "mid-1");
    assertTransport("sendMessage", { content: "hi", fromAgent: "a", fromKey: "k", toAgent: "b" });

    const fallback = await scriptedOk(
      contract,
      "sendMessage",
      { id: "mid-1" },
      async () => await db.sendMessage("a", "k", "b", "hi"),
      "sendMessage fallback failed",
    );
    assert.strictEqual(fallback, "");
  });

  it("getMessages forwards the unreadOnly option and maps message records", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "getMessages",
      [
        { id: "m1", from_agent: "a", to_agent: "b", content: "hello", created_at: 9 },
        { id: "m2", from_agent: "c", to_agent: "b", content: "again", created_at: 10, read_at: 11 },
      ],
      async () => await db.getMessages("b", "k", { unreadOnly: true }),
      "getMessages failed",
    );
    assert.deepStrictEqual(value, [
      { id: "m1", fromAgent: "a", toAgent: "b", content: "hello", createdAt: 9, readAt: undefined },
      { id: "m2", fromAgent: "c", toAgent: "b", content: "again", createdAt: 10, readAt: 11 },
    ]);
    assertTransport("getMessages", { agentKey: "k", agentName: "b", unreadOnly: true });

    const noOpts = await scriptedOk(
      contract,
      "getMessages",
      null,
      async () => await db.getMessages("b", "k"),
      "getMessages no-opts failed",
    );
    assert.deepStrictEqual(noOpts, []);
    assertTransport("getMessages", { agentKey: "k", agentName: "b" });
  });

  it("getMessageOverview maps total/unread/recent headers", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "getMessageOverview",
      {
        total: 3,
        unread: 1,
        recent: [{ id: "m1", from_agent: "a", to_agent: "*", created_at: 4, read_at: 5 }],
      },
      async () => await db.getMessageOverview("a", OVERVIEW_LIMIT),
      "getMessageOverview failed",
    );
    assert.deepStrictEqual(value, {
      total: 3,
      unread: 1,
      recent: [{ id: "m1", fromAgent: "a", toAgent: "*", createdAt: 4, readAt: 5 }],
    });
    assertTransport("getMessageOverview", { agentName: "a", limit: OVERVIEW_LIMIT });
  });

  it("markRead and listAllMessages hit their endpoints", async () => {
    const db = contract.db();
    await scriptedVoid(
      contract,
      "markRead",
      async () => await db.markRead("m1", "b", "k"),
      { agentKey: "k", agentName: "b", messageId: "m1" },
    );

    const all = await scriptedOk(
      contract,
      "listAllMessages",
      [{ id: "m9", from_agent: "x", to_agent: "y", content: "body", created_at: 1 }],
      async () => await db.listAllMessages(),
      "listAllMessages failed",
    );
    assert.strictEqual(requireIndex(all, 0, "no messages returned").content, "body");
    assertTransport("listAllMessages", {});
  });
});

describe("db-cloud plan and admin endpoint contract", () => {
  it("updatePlan posts exact args; getPlan maps null and records", async () => {
    const db = contract.db();
    await scriptedVoid(
      contract,
      "updatePlan",
      async () => await db.updatePlan("a", "k", "goal", "task"),
      { agentKey: "k", agentName: "a", currentTask: "task", goal: "goal" },
    );

    const none = await scriptedOk(
      contract,
      "getPlan",
      null,
      async () => await db.getPlan("a"),
      "getPlan null failed",
    );
    assert.strictEqual(none, null);
    assertTransport("getPlan", { agentName: "a" });

    const plan = await scriptedOk(
      contract,
      "getPlan",
      { agent_name: "a", goal: "g", current_task: "t", updated_at: 8 },
      async () => await db.getPlan("a"),
      "getPlan record failed",
    );
    assert.deepStrictEqual(plan, { agentName: "a", goal: "g", currentTask: "t", updatedAt: 8 });

    const plans = await scriptedOk(
      contract,
      "listPlans",
      [{ agent_name: "a", goal: "g", current_task: "t", updated_at: 8 }],
      async () => await db.listPlans(),
      "listPlans failed",
    );
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(requireIndex(plans, 0, "no plans returned").goal, "g");
    assertTransport("listPlans", {});
  });

  it("admin endpoints post exact args and parse values", async () => {
    const db = contract.db();
    await scriptedVoid(contract, "adminDeleteLock", async () => await db.adminDeleteLock("/x"), { filePath: "/x" });
    await scriptedVoid(contract, "adminDeleteAgent", async () => await db.adminDeleteAgent("a"), { agentName: "a" });

    const resetKey = await scriptedOk(
      contract,
      "adminResetKey",
      { agent_name: "a", agent_key: "k2" },
      async () => await db.adminResetKey("a"),
      "adminResetKey failed",
    );
    assert.deepStrictEqual(resetKey, { agentName: "a", agentKey: "k2" });
    assertTransport("adminResetKey", { agentName: "a" });

    const sent = await scriptedOk(
      contract,
      "adminSendMessage",
      "m-admin",
      async () => await db.adminSendMessage("sys", "a", "hello"),
      "adminSendMessage failed",
    );
    assert.strictEqual(sent, "m-admin");
    assertTransport("adminSendMessage", { content: "hello", fromAgent: "sys", toAgent: "a" });

    await scriptedVoid(contract, "adminReset", async () => await db.adminReset(), {});
  });
});

describe("db-cloud error envelope handling", () => {
  it("propagates the exact DbError code and message", async () => {
    const db = contract.db();
    contract.cloud.script("register", 422, errEnvelope(ERR_CODE, ERR_MSG));
    await expectErrEnvelope(
      async () => await db.register("dup"),
      { code: ERR_CODE, message: ERR_MSG },
    );
  });

  it("falls back to NETWORK_ERROR/Unknown API error without an error object", async () => {
    const db = contract.db();
    contract.cloud.script("register", 200, { ok: false });
    await expectErrEnvelope(
      async () => await db.register("dup"),
      { code: NETWORK_CODE, message: UNKNOWN_MSG },
    );
  });

  it("rejects non-envelope JSON payloads with the network fallback", async () => {
    const db = contract.db();
    contract.cloud.script("listAgents", 200, ["not", "an", "envelope"]);
    await expectErrEnvelope(
      async () => await db.listAgents(),
      { code: NETWORK_CODE, message: UNKNOWN_MSG },
    );
  });

  it("maps non-record values through empty-record defaults", async () => {
    const db = contract.db();
    const reg = await scriptedOk(
      contract,
      "register",
      "scalar",
      async () => await db.register("x"),
      "register scalar failed",
    );
    assert.deepStrictEqual(reg, { agentName: "", agentKey: "" });

    const plan = await scriptedOk(
      contract,
      "getPlan",
      undefined,
      async () => await db.getPlan("x"),
      "getPlan undefined failed",
    );
    assert.strictEqual(plan, null);

    const plans = await scriptedOk(
      contract,
      "listPlans",
      [
        { agent_name: "ok", goal: "g", current_task: "t", updated_at: 1 },
        7,
      ],
      async () => await db.listPlans(),
      "listPlans mixed failed",
    );
    assert.strictEqual(plans.length, 2);
    assert.deepStrictEqual(requireIndex(plans, 1, "expected two plans"), { agentName: "", goal: "", currentTask: "", updatedAt: 0 });
  });
});
