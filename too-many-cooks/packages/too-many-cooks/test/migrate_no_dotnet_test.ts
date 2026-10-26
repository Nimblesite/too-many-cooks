/// [DB-MIGRATE] Contract: migrations run from the bundled, self-contained
/// DataProviderMigrate binary. Requiring .NET (the `dotnet` CLI or an installed
/// runtime) is ILLEGAL — a clean machine has neither, and the VSIX must still
/// create its DB.
///
/// A framework-dependent .NET build ships a small apphost that loads the
/// runtime through `hostfxr` from DOTNET_ROOT or a global install, which CI
/// runners have preinstalled, so a passing migration there proves nothing.
/// Every such apphost embeds the `hostfxr` loader name; a NativeAOT binary
/// does not. This test fails if a DataProvider bump ships a runtime-dependent
/// build for any platform.

import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Per-platform binaries filled by scripts/fetch-dataprovider.mjs. */
const BUNDLED_BINARIES: readonly string[] = [
  join("dataprovider", "darwin-arm64", "DataProviderMigrate"),
  join("dataprovider", "darwin-x64", "DataProviderMigrate"),
  join("dataprovider", "linux-x64", "DataProviderMigrate"),
  join("dataprovider", "win32-x64", "DataProviderMigrate.exe"),
];

/** Loader name embedded in every framework-dependent .NET apphost. */
const DOTNET_HOST_MARKER: string = "hostfxr";

/** Bytes below this cannot hold a self-contained build (an apphost is ~100KB). */
const MIN_SELF_CONTAINED_BYTES: number = 5_000_000;

describe("bundled DataProviderMigrate needs no .NET runtime", () => {
  for (const bin of BUNDLED_BINARIES) {
    it(`${bin} is a self-contained native binary`, () => {
      assert.ok(existsSync(bin), `bundled migrate binary missing: ${bin}`);
      const bytes: Buffer = readFileSync(bin);
      assert.ok(
        bytes.length >= MIN_SELF_CONTAINED_BYTES,
        `${bin} is ${String(bytes.length)} bytes — too small to be self-contained (framework-dependent apphost?)`,
      );
      assert.strictEqual(
        bytes.indexOf(DOTNET_HOST_MARKER),
        -1,
        `${bin} references ${DOTNET_HOST_MARKER}: it needs an installed .NET runtime, which is illegal`,
      );
    });
  }
});
