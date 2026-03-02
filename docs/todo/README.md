# Todo 设计文档索引

本目录用于沉淀 “workflow + automation + plugin(skill/mcp) 驱动 todo” 方案文档。

## 文档清单

- 需求文档：`workflow-driven-todo-requirements.md`
- 实现文档：`workflow-driven-todo-implementation.md`
- 实施计划：`../plans/2026-03-02-workflow-driven-todo-implementation.md`

## 适用范围

- 手动创建 Todo
- Workflow 会话触发创建 Todo
- 自动化任务触发 Workflow 创建 Todo
- Skill/MCP 产出 Todo 候选并通过统一入口写入

## 场景映射（最小约定）

| 场景 | 触发层 | 编排层 | 能力层 | Todo 来源字段（示例） |
|---|---|---|---|---|
| 手动创建 | 用户 | - | - | `source_type=manual`, `source_id=user:<id>` |
| Workflow 手动执行 | 用户 | Workflow | Skill/MCP(可选) | `source_type=workflow`, `source_id=workflow:<template>:<stage>` |
| Automation 定时巡检 | Automation | Workflow(可选) | Skill/MCP(可选) | `source_type=automation`, `source_id=automation:<task_id>` |
| Workflow/Automation 失败分支 | Workflow/Automation | Workflow 规则 | Skill/MCP(可选) | `source_type=workflow|automation`, `trigger_mode=automation` |
| 竞品追踪插件 | 用户/Automation | Workflow(可选) | Plugin(Skill/MCP) | `source_type=plugin`, `source_id=skill:<id>` 或 `mcp:<server>:<tool>` |
| 项目推荐插件 | 用户/Automation | Workflow(阈值/打分) | Plugin(Skill/MCP) | `source_type=plugin`, `source_id=skill:<id>` 或 `mcp:<server>:<tool>` |

## 当前自动化规则落地

- 字段：`workflow_rules.on_error.todo_ingest`
- 创建入口：自动化创建表单
- 编辑入口：自动化任务详情
- 生效行为：任务执行失败时写入 Todo（通过统一 `todo.ingest`）
