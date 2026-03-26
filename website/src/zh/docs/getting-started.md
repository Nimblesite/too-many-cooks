---
layout: layouts/docs.njk
title: 快速开始
lang: zh
eleventyNavigation:
  key: 快速开始
  parent: 介绍
  order: 1
---

Too Many Cooks 是一个 MCP 服务器，让多个 AI 智能体在编辑同一代码库时进行协调。智能体在编辑前锁定文件，互相发送消息，并共享计划以避免冲突。

## 安装

```bash
npm install -g too-many-cooks
```

## 升级

如果你已全局安装，更新所有 TMC 包到最新版本：

```bash
npm update -g too-many-cooks @too-many-cooks/core
```

## 添加到 Claude Code

```bash
claude mcp add --transport http too-many-cooks -- too-many-cooks
```

## 启动服务器

```bash
too-many-cooks
```

服务器默认运行在 `http://localhost:4040`。

## 智能体工作流程

1. **注册** — 调用 `register` 并提供你的智能体名称。你会得到一个密钥——保存好它。
2. **检查状态** — 调用 `status` 查看其他智能体的动态。
3. **编辑前锁定** — 在编辑任何文件之前调用 `lock acquire`。
4. **完成后解锁** — 编辑完成后调用 `lock release`。
5. **沟通** — 使用 `message send` 告知其他智能体你正在做什么。
6. **分享计划** — 使用 `plan update` 让其他智能体了解你的意图。

## 源代码

可在 [GitHub](https://github.com/MelbourneDeveloper/too-many-cooks) 上获取。
