/// [SERVER-DEFAULTS] createTooManyCooksServer() with NO arguments must use
/// the default config and silent logger (src/server.ts `??` fallbacks).
///
/// defaultConfig resolves the workspace at MODULE LOAD time (core/config.ts),
/// so this file sets TMC_WORKSPACE in a top-level statement BEFORE importing
/// anything that pulls in too-many-cooks-core.

import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { after, describe, it } from "node:test";
import assert from "node:assert";

const TMP_PREFIX = "/tmp/tmc-server-defaults-";
const AGENT_NAME = "default-agent";

const workspace: string = mkdtempSync(TMP_PREFIX);
const priorWorkspace: string | undefined = process.env.TMC_WORKSPACE;
process.env.TMC_WORKSPACE = workspace;

const { createTooManyCooksServer } = await import("../src/server.js");

after(() => {
  if (priorWorkspace === undefined) {
    delete process.env.TMC_WORKSPACE;
  } else {
    process.env.TMC_WORKSPACE = priorWorkspace;
  }
  rmSync(workspace, { recursive: true, force: true });
});

describe("createTooManyCooksServer defaults", () => {
  it("uses defaultConfig (our TMC_WORKSPACE) and the silent logger", async () => {
    const result = createTooManyCooksServer();
    if (!result.ok) { assert.fail(`server failed: ${result.error}`); }
    assert.ok(result.value.server !== undefined);

    const registered = await result.value.db.register(AGENT_NAME);
    if (!registered.ok) { assert.fail(`register failed: ${JSON.stringify(registered.error)}`); }
    assert.strictEqual(registered.value.agentName, AGENT_NAME);
    assert.ok(registered.value.agentKey.length > 0);

    const found = await result.value.db.lookupByKey(registered.value.agentKey);
    if (!found.ok) { assert.fail(`lookupByKey failed: ${JSON.stringify(found.error)}`); }
    assert.strictEqual(found.value, AGENT_NAME);

    assert.strictEqual((await result.value.db.close()).ok, true);
  });
});
