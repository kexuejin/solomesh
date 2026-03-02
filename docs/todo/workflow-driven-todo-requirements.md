# Workflow 驱动 Todo 需求文档

Date: 2026-03-01  
Owner: SoloMesh

## 1. 背景

当前系统已具备 `Workflow`、`Scheduled Tasks`、`Skills/MCP` 等能力，但缺少一个统一的 Todo 汇聚入口。  
现状问题：

- 手动、自动化、插件/Skill 产出的待办无法用统一规则治理。
- 去重、合并、溯源逻辑分散，容易重复创建 Todo。
- 执行来源和证据链不统一，后续排查和质量评估成本高。

## 2. 目标

建立一个 **Todo Core 统一入口**，支持多来源写入并在内部完成去重和合并：

- 会话手动创建 Todo
- Workflow 会话触发创建 Todo
- 自动化任务（定时/一次性）创建 Todo
- Skills/MCP 产出的 Todo 候选写入

本方案复用现有 `workflow + skill` 编排能力，不新建独立触发层服务。

## 3. 非目标

- 不在本阶段实现完整插件市场/安装中心。
- 不在本阶段重构现有 Workflow 模板生命周期。
- 不在本阶段引入独立分布式调度系统。

## 4. 关键原则

1. Todo Core 只负责 Todo 治理，不关心来源实现细节。
2. Workflow/Skill 只负责产生候选项，统一通过 Ingest 接口写入。
3. 去重与合并必须在 Todo Core 内部完成，不下放给上游流程。
4. 所有来源必须可溯源（来源、运行批次、证据、触发模式）。

## 5. 角色与来源

- 用户（手动）：直接创建 Todo。
- Workflow（手动触发）：会话中调用流程后创建 Todo。
- Workflow（自动触发）：由定时任务/自动化触发流程后创建 Todo。
- Skill/MCP：流程内步骤调用 Todo 能力写入 Todo。

## 6. 功能需求

### FR-001: 统一 Ingest 能力

系统必须提供统一 Todo Ingest 接口（API/MCP/Skill 均可映射到同一后端逻辑）。

### FR-002: 多来源标准字段

每条 Todo 必须包含来源字段：

- `source_type`: `manual | automation | plugin | workflow`
- `source_id`: 来源标识（流程ID/任务ID/插件ID等）
- `source_run_id`: 本次执行批次ID
- `trigger_mode`: `manual | automation`（可空）
- `evidence`: 证据/上下文摘要

### FR-003: 内部去重与合并

Todo Core 必须在写入时执行去重与合并：

- 输入携带 `dedupe_key` 时优先使用
- 未提供时由系统按规则计算
- 重复项不创建新 Todo，改为合并更新

### FR-004: 合并策略

重复命中时至少执行：

- `occurrence_count + 1`
- 更新 `last_seen_at`
- 合并 `evidence` 与来源运行信息
- 优先级仅可提升，不自动降级

### FR-005: 写入结果可判定

Ingest 响应必须返回：

- `action`: `created | merged | ignored`
- `todo_id`
- `reason`（可选，说明忽略/合并依据）

### FR-006: 审计与可观测

必须可查询“谁在什么流程运行中创建/合并了哪条 Todo”。

## 7. 非功能需求

- 幂等：同一来源重复提交不应重复建单。
- 并发安全：并发写入同一 `dedupe_key` 不产生脏数据。
- 可扩展：新增来源无需修改 Todo Core 领域逻辑。
- 安全：自动化来源可配置限额与权限。

## 8. 数据模型（最小集）

### Todo Ingest Request

- `title` (required)
- `description` (optional)
- `priority` (optional)
- `source_type` (required)
- `source_id` (required)
- `source_run_id` (optional)
- `trigger_mode` (optional)
- `dedupe_key` (optional)
- `evidence` (optional object/array)
- `metadata` (optional object)

### Todo Record（核心字段）

- `id`, `title`, `description`, `status`, `priority`
- `dedupe_key`, `occurrence_count`
- `first_seen_at`, `last_seen_at`
- `created_by`, `created_at`, `updated_at`

### Todo Source Event（建议）

- `todo_id`, `source_type`, `source_id`, `source_run_id`, `trigger_mode`
- `action`, `evidence`, `created_at`

## 9. 验收标准

1. 手动、Workflow 手动触发、Workflow 自动触发均可通过统一入口创建 Todo。
2. 同一问题重复提交时返回 `merged`，不新增重复 Todo。
3. 每条 Todo 可追溯来源和执行批次。
4. 并发场景下无重复建单。
5. 前端/API 能区分本次操作是 `created` 还是 `merged`。

## 10. 里程碑建议

- M1: Todo Core + Ingest + 去重合并 + 审计
- M2: Workflow/Skill 接入统一入口
- M3: 自动化策略（限额、阈值、审批）与观测完善
