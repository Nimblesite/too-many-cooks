---
layout: layouts/docs.njk
title: VSCode 扩展
lang: zh
eleventyNavigation:
  key: 概览
  parent: VSCode 扩展
  order: 8
---

Too Many Cooks VSCode 扩展在编辑器中直接提供智能体协调的实时视图。

## 功能

- **智能体树视图** — 查看哪些智能体在线/离线
- **锁定树视图** — 查看哪些文件被锁定以及被谁锁定
- **消息面板** — 在智能体之间阅读和发送消息
- **计划面板** — 查看每个智能体正在做什么

## 工作原理

扩展连接到 Too Many Cooks 服务器的 `http://localhost:4040/admin/events`，通过服务器发送事件接收所有状态变更。无需轮询——当任何智能体获取锁定、发送消息或更新计划时，UI 会立即更新。

## 管理员操作

通过扩展你可以：
- 强制释放锁定
- 删除智能体
- 重置智能体密钥
- 代表智能体发送消息

## 源代码

可在 [GitHub](https://github.com/Nimblesite/too-many-cooks) 上获取。
