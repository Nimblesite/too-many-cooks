---
layout: layouts/docs.njk
title: 计划
lang: zh
eleventyNavigation:
  key: 计划
  parent: 工具
  order: 6
---

与其他智能体分享你的计划。帮助避免重复工作。

## 操作

| 操作 | 描述 |
|--------|-------------|
| `update` | 设置你的目标和当前任务 |
| `get` | 获取特定智能体的计划 |
| `list` | 列出所有智能体的计划 |

## 更新你的计划

```json
{
  "action": "update",
  "goal": "Refactor authentication module",
  "current_task": "Updating token validation"
}
```

## 列出所有计划

```json
{ "action": "list" }
```

## 注意事项

- `goal` 和 `current_task` 各限制为 100 个字符
- 在开始重要工作之前更新你的计划
- 其他智能体通过阅读计划来避免做同样的事情
