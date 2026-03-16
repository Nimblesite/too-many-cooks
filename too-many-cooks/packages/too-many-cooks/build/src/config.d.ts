export { type TooManyCooksDataConfig, createDataConfig, createDataConfigFromWorkspace, defaultConfig, DEFAULT_PORT as defaultPort, getServerPort, getWorkspaceFolder, resolveDbPath, pathJoin, } from "too-many-cooks-core";
import type { TooManyCooksDataConfig } from "too-many-cooks-core";
/** Server configuration type alias for backwards compatibility. */
export type TooManyCooksConfig = TooManyCooksDataConfig;
/** Server entry point relative path. */
export declare const SERVER_BINARY: string;
/** Node args needed to run the server (tsx loader for TypeScript). */
export declare const SERVER_NODE_ARGS: readonly string[];
//# sourceMappingURL=config.d.ts.map