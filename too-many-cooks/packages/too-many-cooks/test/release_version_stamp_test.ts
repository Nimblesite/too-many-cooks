/// [CI-RELEASE] The release workflow stamps the tag's version with
/// scripts/stamp-version.sh. This test runs that same script with a test
/// version against a throwaway copy of every published package.json, so a
/// broken stamper fails `make test` instead of a tagged release.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives in too-many-cooks/packages/too-many-cooks/test). */
const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const STAMP_SCRIPT: string = join(REPO_ROOT, "scripts", "stamp-version.sh");
const TEST_VERSION: string = "9.8.7-stamptest.1";
const TMP_PREFIX: string = "tmc-stamp-";
const PACKAGE_JSON: string = "package.json";
const CORE_DEP: string = "too-many-cooks-core";

/** Every package.json the release publishes, relative to the repo root. */
const PACKAGE_DIRS: readonly string[] = [
  "too-many-cooks/packages/core",
  "too-many-cooks/packages/too-many-cooks",
  "too_many_cooks_vscode_extension",
];
const SERVER_DIR: string = "too-many-cooks/packages/too-many-cooks";

type PackageFields = { readonly version: unknown; readonly dependencies: unknown };

const readPackage = (root: string, rel: string): PackageFields => {
  const parsed: unknown = JSON.parse(readFileSync(join(root, rel, PACKAGE_JSON), "utf8"));
  return typeof parsed === "object" && parsed !== null
    ? {
        version: "version" in parsed ? parsed.version : undefined,
        dependencies: "dependencies" in parsed ? parsed.dependencies : undefined,
      }
    : { version: undefined, dependencies: undefined };
};

const coreDependency = (deps: unknown): unknown =>
  typeof deps === "object" && deps !== null && CORE_DEP in deps
    ? Object.entries(deps).find(([name]: [string, unknown]): boolean => name === CORE_DEP)?.[1]
    : undefined;

describe("release version stamping (scripts/stamp-version.sh)", () => {
  const fakeRoot: string = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  let output: string = "";

  before(() => {
    for (const rel of PACKAGE_DIRS) {
      mkdirSync(join(fakeRoot, rel), { recursive: true });
      copyFileSync(join(REPO_ROOT, rel, PACKAGE_JSON), join(fakeRoot, rel, PACKAGE_JSON));
    }
    output = execFileSync("bash", [STAMP_SCRIPT, TEST_VERSION, fakeRoot], { encoding: "utf8" });
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

  it("never touches the real package.json files", () => {
    for (const rel of PACKAGE_DIRS) {
      assert.notStrictEqual(readPackage(REPO_ROOT, rel).version, TEST_VERSION, `${rel} was mutated`);
    }
  });
});
