import { type Logger, type Result, type ServerBundle, type TooManyCooksDataConfig } from "@too-many-cooks/core";
export { createMcpServerForDb, createConsoleLogger, type ServerBundle } from "@too-many-cooks/core";
/** Create the Too Many Cooks MCP server with a local SQLite DB. */
export declare const createTooManyCooksServer: (config?: TooManyCooksDataConfig, logger?: Logger) => Result<ServerBundle, string>;
//# sourceMappingURL=server.d.ts.map