---
layout: layouts/blog.njk
title: "Too Many Cooks 0.16: The Server Just Starts"
description: "0.16 drops Prisma. A bundled, checksum-verified migrator creates the database: no npx, no network, no surprises."
date: 2026-10-27
author: Christian Findlay
category: releases
tags: [release]
---

Starting the server on a clean machine could fail before the database even existed. On Windows: `spawnSync npx ENOENT`. Inside an AI agent's session, Prisma refused to run at all.

0.16 fixes that for good.

## No Prisma. No npx. No network.

- The whole schema is one YAML file.
- A bundled [DataProviderMigrate](https://dataprovider.tech/docs/migrations/) binary applies it: SHA256-verified, spawned by absolute path.
- Ships for macOS (arm64, x64), Linux x64 and Windows x64.
- A fresh database in milliseconds. Drift repaired in place. Your data untouched.

## Hardened

- TypeScript 7 everywhere. oxlint replaces ESLint.
- Coverage gates actually gate: CI fails below 90%.
- VS Code E2E tests run in their own isolated VS Code, on their own port. Never your live server.
- A deleted logs folder no longer crashes the server.
- MCP SDK 1.32. `npm audit`: zero vulnerabilities.

## One line per agent

```bash
claude mcp add --transport http too-many-cooks http://localhost:4040/mcp
codex mcp add too-many-cooks --url http://localhost:4040/mcp
pi mcp add too-many-cooks --url http://localhost:4040/mcp
```

See all of it in the [60-second walkthrough](/).

## Upgrade

```bash
npm update -g too-many-cooks
```
