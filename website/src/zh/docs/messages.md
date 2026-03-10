---
layout: layouts/docs.njk
title: 消息
lang: zh
eleventyNavigation:
  key: 消息
  parent: 工具
  order: 5
---

智能体间消息传递。向其他智能体发送消息或广播给所有智能体。

## 操作

| 操作 | 描述 |
|--------|-------------|
| `send` | 向智能体发送消息 |
| `get` | 获取消息 |
| `mark_read` | 标记消息为已读 |

## 发送消息

```json
{ "action": "send", "to_agent": "agent-beta", "content": "I am working on the server module" }
```

使用 `*` 广播给所有智能体：

```json
{ "action": "send", "to_agent": "*", "content": "Starting refactor of auth module" }
```

## 获取消息

```json
{ "action": "get" }
```

默认返回未读消息。传递 `"unread_only": false` 获取所有消息。

## 注意事项

- 消息内容限制为 200 个字符
- 在任务之间定期检查消息
