---
layout: layouts/docs.njk
title: 锁定
lang: zh
eleventyNavigation:
  key: 锁定
  parent: 工具
  order: 4
---

建议性文件锁定。编辑前锁定文件，完成后释放。

## 操作

| 操作 | 描述 |
|--------|-------------|
| `acquire` | 锁定文件路径 |
| `release` | 释放你的锁定 |
| `renew` | 延长锁定过期时间 |
| `force_release` | 释放过期的锁定（任何智能体） |
| `query` | 检查特定文件是否被锁定 |
| `list` | 列出所有活跃的锁定 |

## 获取锁定

```json
{ "action": "acquire", "file_path": "src/server.ts" }
```

## 释放锁定

```json
{ "action": "release", "file_path": "src/server.ts" }
```

## 注意事项

- 锁定默认在 10 分钟后过期
- `force_release` 仅对过期的锁定有效
- `query` 和 `list` 不需要身份验证
- 锁定使用乐观并发（版本列）来防止竞争
