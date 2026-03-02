# Todo 设计文档索引

本目录用于沉淀 “workflow + automation + plugin(skill/mcp) 驱动 todo” 方案文档。

## 文档清单

- 需求文档：`workflow-driven-todo-requirements.md`
- 实现文档：`workflow-driven-todo-implementation.md`
- 实施计划：`workflow-driven-todo-implementation.md`（见文档第 10 节分阶段实施建议）

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

- 字段：`task_config.on_error.todo_ingest`
- 创建入口：自动化创建表单
- 编辑入口：自动化任务详情
- 生效行为：任务执行失败时写入 Todo（通过统一 `todo.ingest`）
- 指标入口：`GET /api/todos/metrics`（支持按来源与日期过滤查看 created/merged 比率）

## 轻量 Git 增量游标（不新增表）

- 复用字段：
  - 配置：`scheduled_tasks.task_config.plugins.competitor_git`
  - 状态：`scheduled_tasks.task_state.plugins.competitor_git`
- 配置入口约束：
  - 通过内置模板/Workflow 在创建任务时注入 `task_config` 默认值
  - 通用 Task 创建/编辑表单不新增业务专用字段
  - 调度器只读取 `task_config/task_state`，不再从 prompt 文本解析 hint
- 示例：

```json
{
  "task_config": {
    "on_error": { "todo_ingest": true },
    "plugins": {
      "competitor_git": {
        "enabled": true,
        "repo": "https://github.com/example/competitor",
        "branch": "main",
        "lookback_commits": 50
      }
    }
  },
  "task_state": {
    "plugins": {
      "competitor_git": {
        "last_sha": "abc1234",
        "last_scan_at": "2026-03-02T12:00:00.000Z"
      }
    }
  }
}
```

- 调度器行为：
  - 成功执行后从结果提取 `competitor_git_next_sha`（或 `SOLOMESH_COMPETITOR_GIT_HEAD`）并回写 `last_sha`
  - 下次执行按 `last_sha..HEAD` 增量分析

## 当前内置验证资产

- 内置 Workflow 模板：
  - `competitor-watch`（竞品追踪，最终阶段 `emit-todo` 写入 Todo）
  - `project-recommendation`（项目推荐，最终阶段 `emit-todo` 写入 Todo）
- 内置 Automation 模板：
  - `competitor-watch`
  - `project-recommendation`
  - 默认开启失败规则：`task_config.on_error.todo_ingest=true`
- 内置 Skill（Plugin 示例）：
  - `container/skills/competitor-tracker/SKILL.md`
  - `container/skills/project-recommender/SKILL.md`

## 会话命令快速验证（Automation）

- 支持会话命令直接创建自动化任务：`/auto <template-id> [参数]`
- 示例（竞品追踪，使用 OpenHands 仓库）：

```text
/auto competitor-watch repo=https://github.com/OpenHands/OpenHands branch=main lookback=50
```
