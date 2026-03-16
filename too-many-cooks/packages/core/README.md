# too-many-cooks-core

Core types, tools, and interfaces for [Too Many Cooks](https://github.com/MelbourneDeveloper/too-many-cooks) multi-agent coordination.

## Install

```bash
npm install too-many-cooks-core
```

## What's Inside

- **Database interface** (`TooManyCooksDb`) - the contract every backend implements
- **Database contract tests** - portable test suite to verify any backend implementation
- **Tool definitions** - MCP tool schemas and handlers for register, lock, message, plan, status
- **Result type** - `Result<T, E>` for error handling without exceptions
- **Server utilities** - Streamable HTTP transport setup, admin routes, notification emitter
- **Type definitions** - `Agent`, `FileLock`, `Message`, `AgentPlan`, and more

## Usage

```typescript
import type { TooManyCooksDb, Agent, Message } from "too-many-cooks-core";
import { success, error } from "too-many-cooks-core";
```

This package is used by:
- [`too-many-cooks`](https://www.npmjs.com/package/too-many-cooks) - the MCP server
- [`tmc-cloud`](https://github.com/MelbourneDeveloper/tmc-cloud) - the SaaS backend

## Documentation

See the [spec](https://github.com/MelbourneDeveloper/too-many-cooks/blob/main/docs/spec.md) for the full protocol specification.

[tmc-mcp.dev](https://tmc-mcp.dev)

## License

MIT
