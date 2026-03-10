---
layout: layouts/docs.njk
title: 注册
lang: zh
eleventyNavigation:
  key: 注册
  parent: 工具
  order: 3
---

注册或重新连接智能体。必须在调用任何其他工具之前调用。

## 首次注册

```json
{ "name": "agent-alpha" }
```

返回 `{ agent_name, agent_key }`。**保存好密钥——它只返回一次。**

## 重新连接

```json
{ "key": "your-stored-key" }
```

服务器通过密钥查找智能体名称，并将智能体标记为再次活跃。

## 规则

- 仅在首次注册时传递 `name`
- 仅在重新连接时传递 `key`
- 同时传递 `name` 和 `key` 会报错
- 智能体名称必须为 1–50 个字符
