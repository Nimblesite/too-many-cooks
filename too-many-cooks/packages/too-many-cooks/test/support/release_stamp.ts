/// Shared release-stamp fixture ([DEDUP-DESLOP]).
///
/// `scripts/stamp-version.sh` rewrites every published package.json plus
/// shipwright.json; both stamping test files re-declared the repo paths,
/// the package list and the "copy the real manifests into a throwaway
/// root" loop. Those live here once.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord } from "./json.js";

/** Repo root (support/ sits five levels below it: test/support → pkg → packages → repo). */
export const REPO_ROOT: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

/** The stamper the release workflow runs. */
export const STAMP_SCRIPT: string = join(REPO_ROOT, "scripts", "stamp-version.sh");

/** Manifest filename the stamper rewrites. */
export const PACKAGE_JSON: string = "package.json";

/** Shipwright manifest filename the stamper rewrites. */
export const MANIFEST: string = "shipwright.json";

/** Name of the core package the server depends on. */
export const CORE_DEP: string = "too-many-cooks-core";

/** Every package.json the release publishes, relative to the repo root. */
export const PACKAGE_DIRS: readonly string[] = [
  "too-many-cooks/packages/core",
  "too-many-cooks/packages/too-many-cooks",
  "too_many_cooks_vscode_extension",
];

/** The server package, relative to the repo root. */
export const SERVER_DIR: string = "too-many-cooks/packages/too-many-cooks";

/** Copies every published package.json under `root` into `fakeRoot`. */
export const copyPackageJsons = (fakeRoot: string): void => {
  for (const rel of PACKAGE_DIRS) {
    mkdirSync(join(fakeRoot, rel), { recursive: true });
    copyFileSync(
      join(REPO_ROOT, rel, PACKAGE_JSON),
      join(fakeRoot, rel, PACKAGE_JSON),
    );
  }
};

/** Copies the shipwright manifest of `root` into `fakeRoot`. */
export const copyManifest = (fakeRoot: string): void => {
  copyFileSync(join(REPO_ROOT, MANIFEST), join(fakeRoot, MANIFEST));
};

/** Runs the stamper against `fakeRoot` with `version`; returns its stdout. */
export const stampVersion = (fakeRoot: string, version: string): string =>
  execFileSync("bash", [STAMP_SCRIPT, version, fakeRoot], { encoding: "utf8" });

/** Reads `root`'s JSON manifest at `rel` and returns its parsed object. */
const readJson = (root: string, rel: string): unknown =>
  JSON.parse(readFileSync(join(root, rel), "utf8"));

/** Field of a parsed JSON object, or undefined when absent. */
const fieldOf = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

/** The `version` and `dependencies` of `root`'s package.json at `rel`. */
export type PackageFields = {
  readonly version: unknown;
  readonly dependencies: unknown;
};

/** Reads the version/dependencies of `root`'s package.json at `rel`. */
export const readPackage = (root: string, rel: string): PackageFields => {
  const parsed = readJson(root, join(rel, PACKAGE_JSON));
  return {
    version: fieldOf(parsed, "version"),
    dependencies: fieldOf(parsed, "dependencies"),
  };
};

/** The core dependency range declared in `deps`, or undefined. */
export const coreDependency = (deps: unknown): unknown => fieldOf(deps, CORE_DEP);

/** shipwright.json `product.version` under `root`. */
export const manifestVersion = (root: string): unknown =>
  fieldOf(fieldOf(readJson(root, MANIFEST), "product"), "version");
