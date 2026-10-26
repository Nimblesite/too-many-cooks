/// [SWR-VERSION-BINDINGS] [SWR-VERSION-HANDSHAKE] serverInfo comes from the
/// package.json the release stamps — never a hard-coded version literal.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpServerInfo, type PackageMetadata, type ServerInfo } from "@nimblesite/shipwright-mcp";

import { type Result, error, success } from "./result.js";

export type { ServerInfo } from "@nimblesite/shipwright-mcp";

/** Shipwright component id reported by every Too Many Cooks surface. */
export const SERVER_NAME: string = "too-many-cooks";

const PACKAGE_JSON: string = "package.json";
const NOT_FOUND: string = "no package.json above";
const INVALID_METADATA: string = "invalid package metadata";

/** Nearest package.json at or above `dir` (src/ under tsx and build/ under node). */
const findPackageJson = (dir: string): string | undefined => {
  const candidate: string = join(dir, PACKAGE_JSON);
  if (existsSync(candidate)) {return candidate;}
  const parent: string = dirname(dir);
  return parent === dir ? undefined : findPackageJson(parent);
};

/** Narrow a loaded package.json to the metadata shipwright validates. */
const toMetadata = (raw: unknown): PackageMetadata =>
  typeof raw === "object" && raw !== null && "version" in raw && typeof raw.version === "string"
    ? { version: raw.version }
    : {};

/** serverInfo for the package that owns `moduleUrl` (pass `import.meta.url`). */
export const serverInfoFor = (moduleUrl: string): Result<ServerInfo, string> => {
  const packageJson: string | undefined = findPackageJson(dirname(fileURLToPath(moduleUrl)));
  if (packageJson === undefined) {return error(`${NOT_FOUND} ${moduleUrl}`);}
  const raw: unknown = createRequire(moduleUrl)(packageJson);
  const info: ReturnType<typeof createMcpServerInfo> = createMcpServerInfo(toMetadata(raw), SERVER_NAME);
  return info.ok && info.value !== undefined
    ? success(info.value)
    : error(`${packageJson}: ${info.error ?? INVALID_METADATA}`);
};
