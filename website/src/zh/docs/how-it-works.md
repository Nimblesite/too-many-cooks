---
layout: layouts/docs.njk
title: 工作原理
lang: zh
eleventyNavigation:
  key: 工作原理
  parent: 介绍
  order: 2
---

Too Many Cooks 在每个工作区运行一个 HTTP 服务器。智能体通过 MCP Streamable HTTP 连接。VSCode 扩展通过管理员 REST 端点连接。

## 架构

一个服务器，三种客户端：

- **AI 智能体** — 通过 `/mcp`（MCP Streamable HTTP）连接
- **VSCode 扩展** — 通过 `/admin/*`（REST + SSE）连接
- **SQLite 数据库** — 位于 `.too_many_cooks/data.db` 的唯一数据源

## 实时事件

服务器将事件推送给所有连接的客户端——无需轮询。当一个智能体获取锁定时，所有其他智能体和 VSCode 扩展会立即收到通知。

事件包括：`lock_acquired`、`lock_released`、`message_sent`、`plan_updated`、`agent_activated`、`agent_deactivated`。

## 会话身份

智能体在每次连接时注册一次。服务器在会话状态中存储智能体名称和密钥。所有后续工具调用自动使用会话身份——无需在每次调用时传递凭据。

## 数据库结构

| 表 | 用途 |
|-------|---------|
| `identity` | 已注册的智能体及其活动状态 |
| `locks` | 带有过期时间和版本的文件锁定 |
| `messages` | 智能体间消息 |
| `plans` | 智能体目标和当前任务 |

## 为什么选择 HTTP 而不是 stdio

Stdio 为每个智能体生成一个隔离的进程。智能体无法看到彼此的事件。HTTP 提供一个共享进程，通知发射器可以在所有连接的智能体之间工作。
