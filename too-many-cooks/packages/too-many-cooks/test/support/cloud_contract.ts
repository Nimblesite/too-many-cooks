/// [CLOUD-API-CONTRACT] Shared fixture for the src/db-cloud.ts contract tests
/// ([DEDUP-DESLOP]).
///
/// Every cloud contract file needs the same constants, an in-process fake API,
/// a db wired to it for the whole file, and a transport assertion that pins the
/// exact headers/body of the most recent call. Those live here once.

import assert from "node:assert";
import { after, before } from "node:test";

import { createCloudDb } from "../../src/db-cloud.js";
import { FakeCloudApi } from "./fake_cloud_api.js";

/** API key the cloud db is created with. */
export const CLOUD_API_KEY = "test-api-key-123";

/** Workspace ID the cloud db is created with. */
export const CLOUD_WORKSPACE_ID = "ws-42";

/** Expected Authorization header value. */
export const CLOUD_BEARER = `Bearer ${CLOUD_API_KEY}`;

/** Content type every cloud call must send. */
export const CLOUD_CONTENT_TYPE = "application/json";

/** The db `createCloudDb` returns. */
export type CloudContractDb = ReturnType<typeof createCloudDb>;

/** Fake cloud API plus the db-under-test bound by `bindCloudContract`. */
export type CloudContract = {
  readonly cloud: FakeCloudApi;
  /** The db under test; fails the test when used before `before` ran. */
  readonly db: () => CloudContractDb;
  /** Asserts the transport contract on the most recent call to `endpoint`. */
  readonly assertTransport: (endpoint: string, expectedBody: unknown) => void;
};

/** Wires the fake API + db lifecycle around the calling describe block. */
export const bindCloudContract = (): CloudContract => {
  const cloud = new FakeCloudApi();
  let db: CloudContractDb | undefined;
  before(async () => {
    const url: string = await cloud.start();
    db = createCloudDb(url, CLOUD_API_KEY, CLOUD_WORKSPACE_ID);
  });
  after(async () => {
    await cloud.close();
  });
  return {
    cloud,
    db: (): CloudContractDb => {
      assert.ok(db !== undefined, "cloud contract db not created");
      return db;
    },
    assertTransport: (endpoint: string, expectedBody: unknown): void => {
      assertTransport(cloud, endpoint, expectedBody);
    },
  };
};

/** Asserts method, auth, workspace, content type and body of the last call. */
export const assertTransport = (
  cloud: FakeCloudApi,
  endpoint: string,
  expectedBody: unknown,
): void => {
  const req = cloud.last(endpoint);
  assert.strictEqual(req.httpMethod, "POST");
  assert.strictEqual(req.headers.authorization, CLOUD_BEARER);
  assert.strictEqual(req.headers["x-workspace-id"], CLOUD_WORKSPACE_ID);
  assert.strictEqual(req.headers["content-type"], CLOUD_CONTENT_TYPE);
  assert.deepStrictEqual(req.body, expectedBody);
};
