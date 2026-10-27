/// [SWR-VERSION-HANDSHAKE] [SWR-VERSION-CLI-OUTPUT] Regression: every release
/// lied about its version. scripts/stamp-version.sh stamps package.json, but
/// `--version` and both MCP `serverInfo` handshakes reported hard-coded
/// literals ("0.5.0" / "0.1.0"), so the published too-many-cooks@0.15.1 said
/// it was 0.5.0. This test stamps a throwaway copy of the BUILT server with the
/// same stamper the release runs, then asserts every surface reports the
/// stamped version.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpHttpClient, ADMIN_EVENTS_PATH, MCP_PATH, type ClientInfo } from "./support/mcp_http.js";
import { getRecordField, getStringField, parseJsonRecord } from "./support/json.js";
import {
  REPO_ROOT,
  SERVER_DIR,
  copyManifest,
  copyPackageJsons,
  stampVersion,
} from "./support/release_stamp.js";
import {
  buildBaseUrl,
  spawnServer,
  waitForServer,
  type SpawnedServer,
  stopAndRemoveAll,
} from "./support/server_process.js";

const TEST_VERSION: string = "9.8.7-versiontest.1";
const SERVER_NAME: string = "too-many-cooks";
const TMP_PREFIX: string = "tmc-version-";
const PORT: number = 4095;
const WAIT_ATTEMPTS: number = 100;
const WAIT_INTERVAL_MS: number = 100;
const CLIENT: ClientInfo = { name: "stamped-version-test", version: "1.0.0" };

const WORKSPACE_NODE_MODULES: string = "too-many-cooks/node_modules";
/** Published server payload copied verbatim (dataprovider is linked: large binaries). */
const SERVER_COPY_DIRS: readonly string[] = ["build", "schema"];
const SERVER_LINK_DIRS: readonly string[] = ["dataprovider"];
const SERVER_ENTRY: string = join("build", "bin", "server.js");

/** Lay out a fake repo: package.jsons, the built server, linked deps. */
const buildFakeRoot = (fakeRoot: string): void => {
  copyPackageJsons(fakeRoot);
  for (const dir of SERVER_COPY_DIRS) {
    cpSync(join(REPO_ROOT, SERVER_DIR, dir), join(fakeRoot, SERVER_DIR, dir), { recursive: true });
  }
  for (const dir of SERVER_LINK_DIRS) {
    symlinkSync(join(REPO_ROOT, SERVER_DIR, dir), join(fakeRoot, SERVER_DIR, dir));
  }
  symlinkSync(join(REPO_ROOT, WORKSPACE_NODE_MODULES), join(fakeRoot, WORKSPACE_NODE_MODULES));
  copyManifest(fakeRoot);
};

/** Run the stamped server entry with CLI args and return stdout. */
const runEntry = (entry: string, args: readonly string[]): string =>
  execFileSync("node", [entry, ...args], { encoding: "utf8" });

/** serverInfo.version from an MCP initialize on `path`. */
const handshakeVersion = async (path: string): Promise<string> => {
  const client: McpHttpClient = new McpHttpClient({ baseUrl: buildBaseUrl(PORT), path, clientInfo: CLIENT });
  const init: Record<string, unknown> = await client.initSession();
  return getStringField(getRecordField(init, "serverInfo"), "version");
};

describe("a release-stamped server reports the stamped version everywhere", () => {
  const fakeRoot: string = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  const entry: string = join(fakeRoot, SERVER_DIR, SERVER_ENTRY);
  const spawned: SpawnedServer[] = [];

  before(async () => {
    buildFakeRoot(fakeRoot);
    stampVersion(fakeRoot, TEST_VERSION);
    spawned.push(spawnServer({ port: PORT, tmpPrefix: join(tmpdir(), TMP_PREFIX), binary: entry }));
    await waitForServer(buildBaseUrl(PORT), WAIT_ATTEMPTS, WAIT_INTERVAL_MS);
  });

  after(async () => {
    await stopAndRemoveAll(spawned, "SIGKILL");
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it("--version prints `too-many-cooks <stamped version>`", () => {
    const firstLine: string | undefined = runEntry(entry, ["--version"]).split("\n")[0];
    assert.strictEqual(firstLine, `${SERVER_NAME} ${TEST_VERSION}`);
  });

  it("--version --json reports the stamped version", () => {
    const json: Record<string, unknown> = parseJsonRecord(runEntry(entry, ["--version", "--json"]));
    assert.strictEqual(getStringField(json, "name"), SERVER_NAME);
    assert.strictEqual(getStringField(json, "version"), TEST_VERSION);
  });

  it("agent MCP session (/mcp) serverInfo.version is the stamped version", async () => {
    assert.strictEqual(await handshakeVersion(MCP_PATH), TEST_VERSION);
  });

  it("admin MCP session (/admin/events) serverInfo.version is the stamped version", async () => {
    assert.strictEqual(await handshakeVersion(ADMIN_EVENTS_PATH), TEST_VERSION);
  });
});
