// Download-and-verify helpers shared by the build scripts that pull pinned
// third-party binaries (DataProviderMigrate, the Node runtime for the
// single-executable server). Nothing is used unless its SHA-256 matches.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const download = async (url) => {
  const res = await fetch(url);
  if (!res.ok) { throw new Error(`GET ${url} -> ${res.status}`); }
  return Buffer.from(await res.arrayBuffer());
};

/** `<sha256>  <file>` lines (sha256sum format) -> Map(file -> sha256). */
export const parseSums = (text) => new Map(
  text.trim().split("\n").map((line) => line.trim().split(/\s+/u)).map(([hash, file]) => [file, hash]),
);

/** Download `url` and fail unless it hashes to `expected`. */
export const downloadVerified = async (url, name, expected) => {
  const bytes = await download(url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (expected !== actual) { throw new Error(`SHA256 mismatch for ${name}: ${actual}`); }
  return bytes;
};

/** Extractor for `name` on this host. GNU tar (Linux) cannot read .zip, so
 *  zips use unzip there; Windows' bundled bsdtar reads both formats. */
const extractor = (name) => (name.endsWith(".zip") && process.platform !== "win32"
  ? ["unzip", ["-q", name]]
  : ["tar", ["-xf", name]]);

/** Extract an archive into a fresh temp dir and return the dir. */
export const extract = (name, bytes, prefix) => {
  const work = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(work, name), bytes);
  const [command, args] = extractor(name);
  execFileSync(command, args, { cwd: work, stdio: "inherit" });
  return work;
};
