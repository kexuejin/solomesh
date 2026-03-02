---
name: competitor-tracker
description: 竞品追踪技能。提取竞品功能、定价与发布变化，并输出可直接写入 Todo ingest 的候选项。
---

# Competitor Tracker

## Goal

- 跟踪目标竞品最近变化并形成结构化结论
- 输出可用于 `todo ingest` 的候选条目（title/description/evidence/dedupe_key）

## Output Contract

每个候选项至少包含：

- `title`
- `description`
- `priority` (`low|medium|high|critical`)
- `dedupe_key`
- `evidence`（包含来源链接、时间、变化摘要）

## Suggested Steps

1. 收集竞品变化信号（功能、定价、公告、发布日志）。
2. 按影响面和紧急度排序。
3. 生成 Todo 候选并补齐 evidence 与 dedupe key。

## Notes

- 不直接写数据库；仅产出候选，由 workflow/automation 调用统一 `todo ingest`。
