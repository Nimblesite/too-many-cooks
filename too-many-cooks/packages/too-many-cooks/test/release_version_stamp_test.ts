/// [CI-RELEASE] [SWR-VERSION-BUILD-STAMPING] The release workflow stamps the
/// tag's version with scripts/stamp-version.sh. This test runs that same script
/// with a test version against a throwaway copy of every published package.json
/// and shipwright.json, so a broken stamper fails `make test` instead of a
/// tagged release.

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
const MANIFEST: string = "shipwright.json";
/** Source versions are never release versions; only the release runner stamps. */
const SOURCE_VERSION: string = "0.0.0-dev";

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

/** shipwright.json `product.version` under `root`. */
const manifestVersion = (root: string): unknown => {
  const parsed: unknown = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  const product: unknown = typeof parsed === "object" && parsed !== null && "product" in parsed ? parsed.product : undefined;
  return typeof product === "object" && product !== null && "version" in product ? product.version : undefined;
};

describe("release version stamping (scripts/stamp-version.sh)", () => {
  const fakeRoot: string = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  let output: string = "";

  before(() => {
    for (const rel of PACKAGE_DIRS) {
      mkdirSync(join(fakeRoot, rel), { recursive: true });
      copyFileSync(join(REPO_ROOT, rel, PACKAGE_JSON), join(fakeRoot, rel, PACKAGE_JSON));
    }
    copyFileSync(join(REPO_ROOT, MANIFEST), join(fakeRoot, MANIFEST));
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
