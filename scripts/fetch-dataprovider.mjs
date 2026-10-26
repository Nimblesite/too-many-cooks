#!/usr/bin/env node
// [DB-MIGRATE] Fetch the pinned DataProviderMigrate CLI for every supported
// platform into packages/too-many-cooks/dataprovider/<platform>-<arch>/ so the
// published npm package can create the DB offline, with no npx/PATH lookup.
// Every archive is verified against the release's SHA256SUMS. Idempotent: a
// matching version stamp skips the download.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = readFileSync(join(ROOT, "scripts", "dataprovider-version"), "utf8").trim();
const OUT_DIR = join(ROOT, "too-many-cooks", "packages", "too-many-cooks", "dataprovider");
const RELEASE_URL = `https://github.com/Nimblesite/DataProvider/releases/download/v${VERSION}`;
const TOOL = "DataProviderMigrate";
const SUMS_FILE = `${TOOL}-SHA256SUMS`;
const STAMP_FILE = "VERSION";
/** Release platforms; keys match Node's `${process.platform}-${process.arch}`. */
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"];
/** Only the executable and the native SQLite library are needed at runtime. */
const KEEP = /^(DataProviderMigrate(\.exe)?|(lib)?e_sqlite3\.(dylib|so|dll))$/u;

const archiveName = (platform) =>
  `${TOOL}-${VERSION}-${platform}.${platform.startsWith("win32") ? "zip" : "tar.gz"}`;

const download = async (url) => {
  const res = await fetch(url);
  if (!res.ok) { throw new Error(`GET ${url} -> ${res.status}`); }
  return Buffer.from(await res.arrayBuffer());
};

const parseSums = (text) => new Map(
  text.trim().split("\n").map((line) => line.trim().split(/\s+/u)).map(([hash, file]) => [file, hash]),
);

const install = async (platform, sums) => {
  const dest = join(OUT_DIR, platform);
  const stamp = join(dest, STAMP_FILE);
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === VERSION) { return; }
  const name = archiveName(platform);
  const bytes = await download(`${RELEASE_URL}/${name}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (sums.get(name) !== actual) { throw new Error(`SHA256 mismatch for ${name}: ${actual}`); }
  const work = mkdtempSync(join(tmpdir(), "dpm-"));
  writeFileSync(join(work, name), bytes);
  // bsdtar (macOS, Windows 10+, most Linux CI) extracts both .tar.gz and .zip.
  execFileSync("tar", ["-xf", name], { cwd: work, stdio: "inherit" });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  readdirSync(work).filter((f) => KEEP.test(f))
    .forEach((f) => writeFileSync(join(dest, f), readFileSync(join(work, f)), { mode: 0o755 }));
  rmSync(work, { recursive: true, force: true });
  if (!existsSync(join(dest, platform.startsWith("win32") ? `${TOOL}.exe` : TOOL))) {
    throw new Error(`${name} did not contain ${TOOL}`);
  }
  writeFileSync(stamp, `${VERSION}\n`);
  process.stdout.write(`dataprovider: installed ${TOOL} ${VERSION} for ${platform}\n`);
};

const sums = parseSums((await download(`${RELEASE_URL}/${SUMS_FILE}`)).toString("utf8"));
for (const platform of PLATFORMS) { await install(platform, sums); }
