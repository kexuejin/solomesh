# Workflow 驱动 Todo 实现文档

Date: 2026-03-01  
Owner: SoloMesh

## 1. 范围说明

本文档对应《workflow-driven-todo-requirements.md》，目标是给出可直接落地的实现路径。

实现策略：**复用现有 Workflow + Skills/MCP 机制，不新建独立触发层服务**，通过一个 Todo Core 统一承接所有来源写入。

## 2. 现状基线

当前仓库已具备：

- Workflow 模板与发布能力：`/api/workflows/templates/*`
- 自动化任务与运行日志：`/api/tasks/*` + `task_run_logs`
- Skills/MCP 能力编排与调用

当前缺口：

- 无独立 `todos` 领域模型与统一 ingest 入口
- 无统一 dedupe/merge 机制
- 无来源级别审计结构（source/run 维度）

## 3. 目标架构

```text
Manual UI / Workflow / Scheduled Task / Skill(MCP)
                  |
                  v
            Todo Ingest API
                  |
                  v
               Todo Core
      (validate -> dedupe -> merge/create)
                  |
                  v
            SQLite (todos + events)
```

## 4. 模块设计

### 4.1 Todo Core（新增）

建议新增：`src/todo-core.ts`

职责：

- 入参标准化与 schema 校验
- dedupe key 计算
- 合并/创建事务逻辑
- 输出 `created|merged|ignored`

建议核心函数：

- `ingestTodo(input, actor): IngestResult`
- `computeDedupeKey(input): string`
- `mergeTodo(existing, input): MergedTodo`

### 4.2 Todo API（新增）

建议新增：`src/routes/todo.ts`

最小接口：

- `POST /api/todos/ingest`（统一入口）
- `POST /api/todos`（手动创建，可内部转 ingest）
- `GET /api/todos`（查询）
- `GET /api/todos/:id/events`（来源事件追溯）

### 4.3 Schema（扩展）

建议扩展：`src/schemas.ts`

- `TodoIngestSchema`
- `TodoCreateSchema`
- `TodoQuerySchema`

### 4.4 数据层（扩展）

建议扩展：`src/db.ts`

- 新增 `todos` 表
- 新增 `todo_source_events` 表
- 新增读写函数：`insertTodo` / `updateTodoMerge` / `insertTodoSourceEvent` / `getTodoByDedupeKey`

## 5. 数据库建议

### 5.1 `todos`

关键字段：

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `description TEXT`
- `status TEXT NOT NULL DEFAULT 'open'`
- `priority TEXT`
- `dedupe_key TEXT NOT NULL`
- `occurrence_count INTEGER NOT NULL DEFAULT 1`
- `first_seen_at TEXT NOT NULL`
- `last_seen_at TEXT NOT NULL`
- `created_by TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

索引建议：

- `UNIQUE(dedupe_key)`
- `INDEX(status, priority, last_seen_at)`

### 5.2 `todo_source_events`

关键字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `todo_id TEXT NOT NULL`
- `source_type TEXT NOT NULL`
- `source_id TEXT NOT NULL`
- `source_run_id TEXT`
- `trigger_mode TEXT`
- `action TEXT NOT NULL` (`created|merged|ignored`)
- `evidence TEXT`
- `created_at TEXT NOT NULL`

索引建议：

- `INDEX(todo_id, created_at)`
- `INDEX(source_type, source_id, created_at)`

## 6. Ingest 处理流程

1. 校验入参（schema）
2. 计算/确认 `dedupe_key`
3. 开启事务
4. 根据 `dedupe_key` 查重
5. 分支：
- 不存在：创建 todo + 记录 source event（`created`）
- 存在：执行合并策略 + 记录 source event（`merged`）
6. 提交事务并返回结果

合并规则（最小）：

- `occurrence_count += 1`
- `last_seen_at = now`
- `evidence` 追加/去重
- `priority = max(priority_old, priority_new)`（仅升不降）

## 7. 与 Workflow / Skill 集成

### 7.1 Workflow

- 在 workflow stage 中调用 `todo ingest` 能力（HTTP/MCP/Skill 均可）。
- stage 传入 `source_type=workflow`。
- `trigger_mode` 由触发上下文决定（手动/自动化）。

### 7.2 自动化任务

- 定时任务触发 workflow 时传入 `source_type=automation`、`source_id=task_id`、`source_run_id=run_id`。
- Workflow 内最终统一调用 Todo Ingest。

### 7.3 Skill / MCP

- Skill 不直接写库，只调用 `todo ingest`。
- 保证治理策略在 Todo Core 一处生效。

Skill/MCP 调用示例（统一入口）：

```http
POST /api/todos/ingest
Content-Type: application/json

{
  "title": "Review generated DB migration",
  "description": "Candidate from skill output",
  "priority": "medium",
  "source_type": "plugin",
  "source_id": "skill:db-migration-reviewer",
  "source_run_id": "run_2026_03_02_0900",
  "trigger_mode": "automation",
  "evidence": {
    "skill": "db-migration-reviewer",
    "confidence": 0.86
  }
}
```

查询过滤建议：

- `GET /api/todos?status=open&priority=high`
- `GET /api/todos?source_type=workflow&trigger_mode=manual`

## 8. 权限与治理

最小策略：

- 自动化来源是否允许自动创建 Todo（布尔开关）
- 每来源每日上限（防刷单）
- 白名单来源（按 `source_type + source_id`）

建议将策略放在运行配置中，便于后续 UI 配置化。

## 9. 测试方案

### 9.1 单元测试

- `computeDedupeKey` 稳定性
- 合并策略正确性（次数、优先级、证据）
- 幂等输入多次提交行为

### 9.2 集成测试

- `POST /api/todos/ingest` 创建路径
- 重复写入走合并路径
- 并发写入同 dedupe key 无重复记录

### 9.3 端到端测试

- 手动创建 Todo
- workflow 手动触发创建 Todo
- 定时任务触发 workflow 创建 Todo

## 10. 分阶段实施计划

### Phase 1: Core

- 新建 `todos` / `todo_source_events`
- 落地 `todo-core.ts`
- 开通 `POST /api/todos/ingest`

### Phase 2: Integrations

- Workflow 调用 Todo Ingest
- 自动化任务上下文携带 `source_run_id`
- Skill/MCP 接入统一入口

### Phase 3: Governance

- 来源限额与白名单
- 观测指标（创建率、合并率、误报率）
- 运维报表与审计检索

## 11. 风险与回滚

风险：

- dedupe 规则过于粗糙导致误合并
- 自动化来源误报造成 Todo 噪音

缓解：

- 初期对自动化来源默认“可创建但限额低”
- 保留 source event 全链路，支持回溯和人工修正
- dedupe key 支持覆盖（上游可显式传入）
