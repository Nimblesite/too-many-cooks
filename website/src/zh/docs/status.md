---
layout: layouts/docs.njk
title: 状态
lang: zh
eleventyNavigation:
  key: 状态
  parent: 工具
  order: 7
---

获取当前协调状态的完整概览。无需身份验证。

## 调用

```json
{}
```

## 返回内容

- 所有已注册的智能体及其活动状态
- 所有当前的文件锁定
- 所有智能体的计划
- 最近的消息

## 用于了解当前情况

首次连接时调用 `status`，在开始工作之前了解其他智能体正在做什么。
