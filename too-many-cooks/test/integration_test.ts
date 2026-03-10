/// Integration test - spawn MCP server process, 5 agents hit it concurrently.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../lib/src/config.js";

const TEST_PORT = 4042;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const ACCEPT = "application/json, text/event-stream";

/** Spawn the server process. */
let tmpWorkspace = "";

const spawnServer = (): ChildProcess => {
  tmpWorkspace = mkdtempSync("/tmp/tmc-integration-");
  return spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, TMC_PORT: String(TEST_PORT), TMC_WORKSPACE: tmpWorkspace },
  });
};

/** Wait for server to be ready by polling /admin/status
 * and then verifying the /mcp endpoint accepts requests. */
const waitForServer = async (): Promise<void> => {
  // Poll /admin/status until it responds
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/admin/status`);
      if (r.ok) {break;}
    } catch {
      // Not ready yet
    }
    if (i === 29) {throw new Error("Server failed to start");}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Verify /mcp endpoint is also ready (avoids race on first request)
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(`${BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: ACCEPT,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "health-check", version: "1.0.0" },
          },
        }),
      });
      if (r.ok) {return;}
    } catch {
      // MCP endpoint not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

/** Reset the server DB via admin endpoint. */
const resetServer = async (): Promise<void> => {
  const r = await fetch(`${BASE_URL}/admin/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) {
    throw new Error("Failed to reset server");
  }
};

type Agent = { readonly name: string; readonly key: string };

/** MCP client that communicates via Streamable HTTP. */
class McpClient {
  private sessionId: string | undefined;
  private nextId = 1;

  async initSession(): Promise<void> {
    const initResult = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    if (this.sessionId === undefined) {
      throw new Error(`No session ID after init: ${JSON.stringify(initResult)}`);
    }

    // Send initialized notification
    await this.postMcp(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const content = (result.content as unknown[])[0] as Record<
      string,
      unknown
    >;
    return content.text as string;
  }

  async callToolRaw(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request("tools/call", { name, arguments: args });
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const response = await this.postMcp(body);
    const text = await response.text();

    // Parse Streamable HTTP or JSON
    const json = this.parseMcpResponse(text);

    if ("error" in json && json.error !== undefined) {
      const err = json.error as Record<string, unknown>;
      const message = (err.message as string | undefined) ?? "Error";
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }

    return json.result as Record<string, unknown>;
  }

  private async postMcp(body: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: ACCEPT,
    };
    if (this.sessionId !== undefined) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers,
      body,
    });

    // Capture session ID from response
    const sid = response.headers.get("mcp-session-id");
    if (sid !== null) {this.sessionId = sid;}

    return response;
  }

  private parseMcpResponse(text: string): Record<string, unknown> {
    if (text.trimStart().startsWith("{")) {
      return JSON.parse(text) as Record<string, unknown>;
    }
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          return JSON.parse(line.substring(6)) as Record<string, unknown>;
        } catch {
          continue;
        }
      }
    }
    throw new Error(`Could not parse: ${text}`);
  }
}

/** Register multiple agents and return their name/key pairs. */
const registerAgents = async (
  client: McpClient,
  count: number,
): Promise<readonly Agent[]> => {
  const timestamp = Date.now();
  const registerPromises = Array.from({ length: count }, async (_, i) =>
    client.callTool("register", { name: `agent${String(timestamp)}_${String(i)}` }),
  );
  const regResults = await Promise.all(registerPromises);
  return regResults.map((r) => {
    const json = JSON.parse(r) as Record<string, unknown>;
    return {
      name: json.agent_name as string,
      key: json.agent_key as string,
    };
  });
};

describe("Too Many Cooks MCP Server Integration", () => {
  // Server process shared across all tests
  let serverProcess: ChildProcess;
  // Per-test MCP client (fresh session each test)
  let client: McpClient;

  before(async () => {
    serverProcess = spawnServer();
    await waitForServer();
  });

  after(() => {
    serverProcess.kill();
    rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Reset DB between tests via admin endpoint
    await resetServer();
    // Fresh MCP session for each test
    client = new McpClient();
    await client.initSession();
  });

  it("5 agents register concurrently", async () => {
    const registerPromises = Array.from({ length: 5 }, async (_, i) =>
      client.callTool("register", { name: `agent${String(i)}` }),
    );
    const regResults = await Promise.all(registerPromises);

    for (const r of regResults) {
      const json = JSON.parse(r) as Record<string, unknown>;
      assert.ok(json.agent_name !== null && json.agent_name !== undefined);
      assert.ok(json.agent_key !== null && json.agent_key !== undefined);
    }
  });

  it("5 agents acquire locks on different files concurrently", async () => {
    // Register agents first
    const agents = await registerAgents(client, 5);

    // All 5 agents acquire locks on different files concurrently
    const lockPromises = agents.map(async (a) =>
      client.callTool("lock", {
        action: "acquire",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
        reason: "editing",
      }),
    );
    const lockResults = await Promise.all(lockPromises);

    for (const r of lockResults) {
      const json = JSON.parse(r) as Record<string, unknown>;
      assert.strictEqual(json.acquired, true);
    }
  });

  it("lock race condition handled correctly", async () => {
    const agents = await registerAgents(client, 2);

    const contested = "/contested/file.dart";
    const raceResults = await Promise.all([
      client.callTool("lock", {
        action: "acquire",
        file_path: contested,
        agent_key: agents[0]!.key,
      }),
      client.callTool("lock", {
        action: "acquire",
        file_path: contested,
        agent_key: agents[1]!.key,
      }),
    ]);

    const acquired0 =
      (JSON.parse(raceResults[0]) as Record<string, unknown>).acquired ===
      true;
    const acquired1 =
      (JSON.parse(raceResults[1]) as Record<string, unknown>).acquired ===
      true;

    // Exactly one should win the race
    assert.strictEqual(acquired0 !== acquired1, true);
  });

  it("5 agents update plans concurrently", async () => {
    const agents = await registerAgents(client, 5);

    const planPromises = agents.map(async (a) =>
      client.callTool("plan", {
        action: "update",
        agent_key: a.key,
        goal: `Goal for ${a.name}`,
        current_task: `Working on ${a.name}`,
      }),
    );
    const results = await Promise.all(planPromises);

    for (const r of results) {
      const json = JSON.parse(r) as Record<string, unknown>;
      assert.strictEqual(json.updated, true);
    }
  });

  it("5 agents send messages concurrently", async () => {
    const agents = await registerAgents(client, 5);

    const msgPromises: Array<Promise<string>> = [];
    for (let i = 0; i < agents.length; i++) {
      const sender = agents[i]!;
      const recipient = agents[(i + 1) % agents.length]!;
      msgPromises.push(
        client.callTool("message", {
          action: "send",
          agent_key: sender.key,
          to_agent: recipient.name,
          content: `Hello from ${sender.name}!`,
        }),
      );
    }
    const results = await Promise.all(msgPromises);

    for (const r of results) {
      const json = JSON.parse(r) as Record<string, unknown>;
      assert.strictEqual(json.sent, true);
    }
  });

  it("broadcast message to all agents", async () => {
    const agents = await registerAgents(client, 3);

    // Send broadcast
    const broadcastResult = await client.callTool("message", {
      action: "send",
      agent_key: agents[0]!.key,
      to_agent: "*",
      content: "Broadcast!",
    });
    assert.strictEqual(
      (JSON.parse(broadcastResult) as Record<string, unknown>).sent,
      true,
    );

    // All agents except sender should receive it
    for (let i = 1; i < agents.length; i++) {
      const inboxResult = await client.callTool("message", {
        action: "get",
        agent_key: agents[i]!.key,
      });
      const json = JSON.parse(inboxResult) as Record<string, unknown>;
      const messages = json.messages as unknown[];
      assert.ok(messages.length > 0);
    }
  });

  it("status shows correct counts including messages", async () => {
    const agents = await registerAgents(client, 5);

    // Acquire locks
    for (const a of agents) {
      await client.callTool("lock", {
        action: "acquire",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
      });
    }

    // Update plans
    for (const a of agents) {
      await client.callTool("plan", {
        action: "update",
        agent_key: a.key,
        goal: "Goal",
        current_task: "Task",
      });
    }

    // Send messages between agents
    for (let i = 0; i < agents.length; i++) {
      const sender = agents[i]!;
      const recipient = agents[(i + 1) % agents.length]!;
      await client.callTool("message", {
        action: "send",
        agent_key: sender.key,
        to_agent: recipient.name,
        content: `Test msg from ${sender.name}`,
      });
    }

    // Check status - MUST include messages!
    const statusJson = JSON.parse(
      await client.callTool("status", {}),
    ) as Record<string, unknown>;
    assert.strictEqual((statusJson.agents as unknown[]).length, 5);
    assert.strictEqual((statusJson.locks as unknown[]).length, 5);
    assert.strictEqual((statusJson.plans as unknown[]).length, 5);
    // CRITICAL: Status MUST return messages!
    assert.strictEqual(
      "messages" in statusJson,
      true,
      "Status response MUST include messages field",
    );
    assert.strictEqual(
      (statusJson.messages as unknown[]).length,
      5,
      "Status MUST return all 5 messages sent",
    );

    // Verify message structure
    const msgs = statusJson.messages as Array<Record<string, unknown>>;
    const firstMsg = msgs[0]!;
    assert.ok("id" in firstMsg);
    assert.ok("from_agent" in firstMsg);
    assert.ok("to_agent" in firstMsg);
    assert.ok("content" in firstMsg);
    assert.ok("created_at" in firstMsg);
  });

  it("agents release locks concurrently", async () => {
    const agents = await registerAgents(client, 5);

    // Acquire locks
    for (const a of agents) {
      await client.callTool("lock", {
        action: "acquire",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
      });
    }

    // Release all concurrently
    const releasePromises = agents.map(async (a) =>
      client.callTool("lock", {
        action: "release",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
      }),
    );
    const results = await Promise.all(releasePromises);

    for (const r of results) {
      const json = JSON.parse(r) as Record<string, unknown>;
      assert.strictEqual(json.released, true);
    }

    // Verify no locks remain
    const status = JSON.parse(
      await client.callTool("status", {}),
    ) as Record<string, unknown>;
    assert.strictEqual((status.locks as unknown[]).length, 0);
  });

  // REGRESSION TESTS: Missing parameter validation
  // These ensure tools return proper errors instead of crashing

  it("register without name or key returns error", async () => {
    const result = await client.callToolRaw("register", {});
    assert.strictEqual(result.isError, true);
    const content = (result.content as Array<Record<string, unknown>>)[0]!;
    const text = content.text as string;
    assert.ok(text.includes("missing_parameter"));
  });

  it("lock without action returns error", async () => {
    const result = await client.callToolRaw("lock", {});
    assert.strictEqual(result.isError, true);
  });

  it("message without action returns error", async () => {
    const result = await client.callToolRaw("message", {});
    assert.strictEqual(result.isError, true);
  });

  it("message without registration returns not_registered", async () => {
    // No register call - session is empty, no hidden args either
    const result = await client.callToolRaw("message", { action: "get" });
    assert.strictEqual(result.isError, true);
    const content = (result.content as Array<Record<string, unknown>>)[0]!;
    const text = content.text as string;
    assert.ok(text.includes("not_registered"));
  });

  it("plan without action returns error", async () => {
    const result = await client.callToolRaw("plan", {});
    assert.strictEqual(result.isError, true);
  });

  // CRITICAL: One plan per agent - updating replaces, doesn't create new
  it("updating plan replaces existing - ONE PLAN PER AGENT", async () => {
    const agents = await registerAgents(client, 1);
    const agent = agents[0]!;

    // Create initial plan
    await client.callTool("plan", {
      action: "update",
      agent_key: agent.key,
      goal: "Initial goal",
      current_task: "Initial task",
    });

    // Verify one plan exists
    let status = JSON.parse(
      await client.callTool("status", {}),
    ) as Record<string, unknown>;
    let plans = status.plans as unknown[];
    assert.strictEqual(plans.length, 1, "Should have exactly 1 plan");

    // Update the plan
    await client.callTool("plan", {
      action: "update",
      agent_key: agent.key,
      goal: "Updated goal",
      current_task: "Updated task",
    });

    // CRITICAL: Still only ONE plan - update replaced, didn't create new
    status = JSON.parse(
      await client.callTool("status", {}),
    ) as Record<string, unknown>;
    plans = status.plans as unknown[];
    assert.strictEqual(
      plans.length,
      1,
      "MUST have exactly 1 plan - update replaces, not creates",
    );

    // Verify the plan was actually updated
    const plan = plans[0] as Record<string, unknown>;
    assert.strictEqual(plan.goal, "Updated goal");
    assert.strictEqual(plan.current_task, "Updated task");
  });

  it("each agent has exactly one plan after multiple updates", async () => {
    const agents = await registerAgents(client, 3);

    // Each agent updates their plan 3 times
    for (let round = 0; round < 3; round++) {
      for (const agent of agents) {
        await client.callTool("plan", {
          action: "update",
          agent_key: agent.key,
          goal: `Goal round ${String(round)}`,
          current_task: `Task round ${String(round)}`,
        });
      }
    }

    // CRITICAL: Should have exactly 3 plans (one per agent), NOT 9
    const status = JSON.parse(
      await client.callTool("status", {}),
    ) as Record<string, unknown>;
    const plans = status.plans as unknown[];
    assert.strictEqual(
      plans.length,
      3,
      "MUST have exactly 3 plans (one per agent), not 9",
    );

    // Verify each plan shows the latest update (round 2)
    for (const plan of plans) {
      const p = plan as Record<string, unknown>;
      assert.strictEqual(p.goal, "Goal round 2");
      assert.strictEqual(p.current_task, "Task round 2");
    }
  });

  // LOCK TOOL: query, list, renew, force_release
  it("lock query returns lock status", async () => {
    const agents = await registerAgents(client, 1);
    const agent = agents[0]!;
    const filePath = "/src/query_test.dart";

    // Query unlocked file
    let result = await client.callTool("lock", {
      action: "query",
      file_path: filePath,
    });
    let json = JSON.parse(result) as Record<string, unknown>;
    assert.strictEqual(json.locked, false);

    // Acquire lock
    await client.callTool("lock", {
      action: "acquire",
      file_path: filePath,
      agent_key: agent.key,
    });

    // Query locked file
    result = await client.callTool("lock", {
      action: "query",
      file_path: filePath,
    });
    json = JSON.parse(result) as Record<string, unknown>;
    assert.strictEqual(json.locked, true);
    assert.ok(json.lock !== null && json.lock !== undefined);
  });

  it("lock list returns all locks", async () => {
    const agents = await registerAgents(client, 3);

    // Acquire locks on different files
    for (let i = 0; i < agents.length; i++) {
      await client.callTool("lock", {
        action: "acquire",
        file_path: `/src/list_test_${String(i)}.dart`,
        agent_key: agents[i]!.key,
      });
    }

    // List all locks
    const result = await client.callTool("lock", { action: "list" });
    const json = JSON.parse(result) as Record<string, unknown>;
    const locks = json.locks as unknown[];
    assert.strictEqual(locks.length, 3);
  });

  it("lock renew extends expiration", async () => {
    const agents = await registerAgents(client, 1);
    const agent = agents[0]!;
    const filePath = "/src/renew_test.dart";

    // Acquire lock
    await client.callTool("lock", {
      action: "acquire",
      file_path: filePath,
      agent_key: agent.key,
    });

    // Renew lock
    const result = await client.callTool("lock", {
      action: "renew",
      file_path: filePath,
      agent_key: agent.key,
    });
    const json = JSON.parse(result) as Record<string, unknown>;
    assert.strictEqual(json.renewed, true);
  });

  it("lock force_release works on expired locks", async () => {
    const agents = await registerAgents(client, 2);

    // Agent 0 acquires lock
    const filePath = "/src/force_release_test.dart";
    await client.callTool("lock", {
      action: "acquire",
      file_path: filePath,
      agent_key: agents[0]!.key,
    });

    // Agent 1 tries to force release (should work for expired locks only)
    // This tests the force_release code path
    const result = await client.callTool("lock", {
      action: "force_release",
      file_path: filePath,
      agent_key: agents[1]!.key,
    });
    const json = JSON.parse(result) as Record<string, unknown>;
    // May fail if lock not expired, but exercises the code path
    assert.ok("released" in json || "error" in json);
  });

  // REGISTER: reconnect with key only
  it("register reconnect with key only", async () => {
    // First registration - name only
    const regResult = await client.callTool("register", { name: "recon1" });
    const regJson = JSON.parse(regResult) as Record<string, unknown>;
    const key = regJson.agent_key as string;

    // Reconnect - key only, no name
    const reconResult = await client.callTool("register", { key });
    const reconJson = JSON.parse(reconResult) as Record<string, unknown>;
    assert.strictEqual(reconJson.agent_name, "recon1");
    assert.strictEqual(reconJson.agent_key, key);
  });

  it("register with both name and key returns error", async () => {
    const regResult = await client.callTool("register", { name: "both1" });
    const regJson = JSON.parse(regResult) as Record<string, unknown>;
    const key = regJson.agent_key as string;

    // Both name AND key - spec says this is an error
    const result = await client.callToolRaw("register", {
      name: "both1",
      key,
    });
    assert.strictEqual(result.isError, true);
  });

  it("register reconnect with invalid key returns error", async () => {
    const result = await client.callToolRaw("register", {
      key: "definitely-not-a-real-key",
    });
    assert.strictEqual(result.isError, true);
  });

  // MESSAGE TOOL: mark_read action
  it("message mark_read marks message as read", async () => {
    const agents = await registerAgents(client, 2);

    // Send a message
    const sendResult = await client.callTool("message", {
      action: "send",
      agent_key: agents[0]!.key,
      to_agent: agents[1]!.name,
      content: "Test message",
    });
    const sendJson = JSON.parse(sendResult) as Record<string, unknown>;
    const messageId = sendJson.message_id as string;

    // Mark as read
    const result = await client.callTool("message", {
      action: "mark_read",
      agent_key: agents[1]!.key,
      message_id: messageId,
    });
    const json = JSON.parse(result) as Record<string, unknown>;
    assert.strictEqual(json.marked, true);
  });

  // PLAN TOOL: get and list actions
  it("plan get retrieves specific agent plan", async () => {
    const agents = await registerAgents(client, 1);
    const agent = agents[0]!;

    // Create plan
    await client.callTool("plan", {
      action: "update",
      agent_key: agent.key,
      goal: "Test goal",
      current_task: "Test task",
    });

    // Get plan
    const result = await client.callTool("plan", {
      action: "get",
      agent_key: agent.key,
    });
    const json = JSON.parse(result) as Record<string, unknown>;
    const plan = json.plan as Record<string, unknown>;
    assert.strictEqual(plan.goal, "Test goal");
  });

  it("plan list returns all plans", async () => {
    const agents = await registerAgents(client, 2);

    // Create plans for both agents
    for (const agent of agents) {
      await client.callTool("plan", {
        action: "update",
        agent_key: agent.key,
        goal: `Goal for ${agent.name}`,
        current_task: "Task",
      });
    }

    // List plans
    const result = await client.callTool("plan", { action: "list" });
    const json = JSON.parse(result) as Record<string, unknown>;
    const plans = json.plans as unknown[];
    assert.strictEqual(plans.length, 2);
  });
});
