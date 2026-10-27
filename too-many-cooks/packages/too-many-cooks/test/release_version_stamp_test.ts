/// [CI-RELEASE] [SWR-VERSION-BUILD-STAMPING] The release workflow stamps the
/// tag's version with scripts/stamp-version.sh. This test runs that same script
/// with a test version against a throwaway copy of every published package.json
/// and shipwright.json, so a broken stamper fails `make test` instead of a
/// tagged release.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PACKAGE_DIRS,
  REPO_ROOT,
  SERVER_DIR,
  copyManifest,
  copyPackageJsons,
  coreDependency,
  manifestVersion,
  readPackage,
  stampVersion,
} from "./support/release_stamp.js";

const TEST_VERSION: string = "9.8.7-stamptest.1";
const TMP_PREFIX: string = "tmc-stamp-";
/** Source versions are never release versions; only the release runner stamps. */
const SOURCE_VERSION: string = "0.0.0-dev";

describe("release version stamping (scripts/stamp-version.sh)", () => {
  const fakeRoot: string = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  let output: string = "";

  before(() => {
    copyPackageJsons(fakeRoot);
    copyManifest(fakeRoot);
    output = stampVersion(fakeRoot, TEST_VERSION);
  });

  after(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it("reports the stamped version and root", () => {
    assert.ok(output.includes(TEST_VERSION), `stamper output must name ${TEST_VERSION}, got: ${output}`);
    assert.ok(output.includes(fakeRoot), `stamper output must name the root ${fakeRoot}, got: ${output}`);
  });

  for (const rel of PACKAGE_DIRS) {
    it(`stamps ${rel}/package.json with the test version`, () => {
      assert.strictEqual(readPackage(fakeRoot, rel).version, TEST_VERSION);
    });
  }

  it("pins the server's core dependency to the stamped version", () => {
    assert.strictEqual(coreDependency(readPackage(fakeRoot, SERVER_DIR).dependencies), `^${TEST_VERSION}`);
  });

  it("stamps the shipwright.json product version", () => {
    assert.strictEqual(manifestVersion(fakeRoot), TEST_VERSION);
  });

  it("source versions are all 0.0.0-dev", () => {
    for (const rel of PACKAGE_DIRS) {
      assert.strictEqual(readPackage(REPO_ROOT, rel).version, SOURCE_VERSION, `${rel} must stay ${SOURCE_VERSION}`);
    }
    assert.strictEqual(manifestVersion(REPO_ROOT), SOURCE_VERSION);
  });

  it("never touches the real package.json files", () => {
    for (const rel of PACKAGE_DIRS) {
      assert.notStrictEqual(readPackage(REPO_ROOT, rel).version, TEST_VERSION, `${rel} was mutated`);
    }
  });
});
