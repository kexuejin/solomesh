# Workflow 驱动 Todo 需求文档

Date: 2026-03-02  
Owner: SoloMesh

## 1. 背景

当前系统已具备 `Workflow`、`Scheduled Tasks`、`Skills/MCP` 等能力，但缺少一个统一的 Todo 汇聚入口。  
现状问题：

- 手动、自动化、插件能力产出的待办无法用统一规则治理。
- 去重、合并、溯源逻辑分散，容易重复创建 Todo。
- 执行来源和证据链不统一，后续排查和质量评估成本高。

## 2. 目标

建立一个 **Todo Core 统一入口**，支持多来源写入并在内部完成去重和合并：

- 会话手动创建 Todo
- Workflow 会话触发创建 Todo
- 自动化任务（定时/一次性）创建 Todo
- Skills/MCP（插件能力）产出的 Todo 候选写入

本方案复用现有 `workflow + automation + skill/mcp` 能力，不新建独立触发层服务，不新增插件技术实体。

## 3. 非目标

- 不在本阶段实现完整插件市场/安装中心。
- 不在本阶段重构现有 Workflow 模板生命周期。
- 不在本阶段引入独立分布式调度系统。

## 4. 概念边界（不新增概念）

1. `Plugin` 仅为产品层术语，技术实现直接映射为 `Skill` 或 `MCP`。
2. `Workflow` 负责流程编排（步骤、条件、分支、依赖）。
3. `Automation` 负责触发（定时/事件），可触发 Workflow 或直接执行能力。
4. `Todo Core` 只负责治理（ingest、去重、合并、审计），不负责触发编排。

## 5. 标准场景（6 类）

1. 手动创建
- 触发者：用户
- 链路：用户 -> Todo
- 来源字段：`source_type=manual`，`trigger_mode=manual`

2. 会话中手动执行 Workflow 后写入 Todo
- 触发者：用户
- 链路：用户 -> Workflow -> Todo
- 来源字段：`source_type=workflow`

3. 自动化定时巡检并写入 Todo
- 触发者：Automation
- 链路：Automation -> Workflow(可选) -> Todo
- 来源字段：`source_type=automation`，`trigger_mode=automation`

4. Workflow/Automation 失败分支写入 Todo
- 触发者：Workflow 或 Automation 的显式 `on_error` 规则
- 链路：Workflow/Automation -> on_error -> Todo
- 原则：失败触发逻辑定义在流程层，不由 Todo Core 隐式决定

5. 竞品追踪插件写入 Todo
- 触发者：Skill/MCP 插件执行（手动或自动）
- 链路：Plugin(Skill/MCP) -> Workflow(可选) -> Todo
- 来源字段：`source_type=plugin`，`source_id` 建议为 `skill:<id>` 或 `mcp:<server>:<tool>`

6. 项目推荐插件写入 Todo
- 触发者：Skill/MCP 插件执行（手动或自动）
- 链路：Plugin(Skill/MCP) -> Workflow(过滤/打分) -> Todo
- 来源字段：`source_type=plugin`，`source_id` 建议为 `skill:<id>` 或 `mcp:<server>:<tool>`

## 6. 功能需求

### FR-001: 统一 Ingest 能力

系统必须提供统一 Todo Ingest 能力（API/MCP/Skill 均可映射到同一后端逻辑）。

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

### FR-007: 触发策略归属

自动化、失败分支、阈值过滤等触发策略必须定义在 Workflow/Automation/Plugin 执行逻辑，不由 Todo Core 内部隐式触发。

当前自动化失败写入 Todo 的最小落地约定：

- 规则字段：`workflow_rules.on_error.todo_ingest = true`
- 规则生效点：Automation 执行出错分支
- 规则行为：命中时调用统一 `todo ingest`

### FR-008: 插件接入约束

Skill/MCP 插件不得直接写 Todo 库，必须通过统一 `todo ingest` 能力写入。

## 7. 非功能需求

- 幂等：同一来源重复提交不应重复建单。
- 并发安全：并发写入同一 `dedupe_key` 不产生脏数据。
- 可扩展：新增来源无需修改 Todo Core 领域逻辑。
- 可治理：来源级策略可在 Workflow/Automation 层按项目配置。

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

1. 场景 1-6 均可通过统一入口创建或合并 Todo。
2. 同一问题重复提交时返回 `merged`，不新增重复 Todo。
3. 每条 Todo 可追溯来源和执行批次。
4. 并发场景下无重复建单。
5. 前端/API 能区分本次操作是 `created` 还是 `merged`。
6. 插件能力通过 Skill/MCP 接入，不新增独立插件基础设施。

## 10. 里程碑建议

- M1: Todo Core + Ingest + 去重合并 + 审计
- M2: Workflow/Automation/Skill(MCP) 接入统一入口
- M3: 流程规则与观测完善（失败分支、阈值、可选限频）
