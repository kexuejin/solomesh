---
name: project-recommender
description: 项目推荐技能。发现值得跟进的新项目并生成可直接写入 Todo ingest 的候选项。
---

# Project Recommender

## Goal

- 发现近期值得关注的新项目/工具
- 以可执行形式输出推荐 Todo 候选

## Output Contract

每个候选项至少包含：

- `title`
- `description`
- `priority` (`low|medium|high|critical`)
- `dedupe_key`
- `evidence`（来源、评分理由、风险提示）

## Suggested Steps

1. 收集候选项目并过滤噪音。
2. 按相关性、影响力、落地成本评分。
3. 输出 Todo 候选，附上推荐理由与下一步动作。

## Notes

- 不直接写数据库；由 workflow/automation 统一调用 `todo ingest`。
