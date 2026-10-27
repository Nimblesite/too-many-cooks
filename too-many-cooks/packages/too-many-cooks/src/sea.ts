/// [SWR-VSIX-BUNDLE] The VSIX ships the server as a Node single-executable
/// application (scripts/build-server-sea.mjs). Inside it there is no
/// node_modules: the better-sqlite3 Node-API addon sits next to the executable.

import { dirname, join } from "node:path";
import { isSea } from "node:sea";
import type Database from "better-sqlite3";

/** Addon file name staged beside the executable by build-server-sea.mjs. */
export const SEA_ADDON_FILE: string = "better_sqlite3.node";

/** better-sqlite3 options: the bundled addon inside the executable, defaults otherwise. */
export const databaseOptions = (): Database.Options =>
  isSea() ? { nativeBinding: join(dirname(process.execPath), SEA_ADDON_FILE) } : {};
