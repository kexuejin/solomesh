# Workflow 驱动 Todo 实现文档

Date: 2026-03-02  
Owner: SoloMesh

## 1. 范围说明

本文档对应《workflow-driven-todo-requirements.md》，目标是给出可直接落地的实现路径。

实现策略：**复用现有 Workflow + Automation + Skills/MCP 机制，不新建独立触发层服务，不新增插件技术实体**，通过一个 Todo Core 统一承接所有来源写入。

## 2. 现状基线

当前仓库已具备：

- Workflow 模板与发布能力：`/api/workflows/templates/*`
- 自动化任务与运行日志：`/api/tasks/*` + `task_run_logs`
- Skills/MCP 能力编排与调用
- Todo Core 入口与路由：`/api/todos/ingest`、`/api/todos`

当前重点：

- 统一来源契约和场景落地口径
- 将触发逻辑稳定收敛在 Workflow/Automation
- 保持 Todo Core 只做治理，不承接触发判断

## 3. 目标架构

```text
Manual UI / Workflow / Automation / Plugin(Skill|MCP)
                        |
                        v
                  todo.ingest
                        |
                        v
                     Todo Core
         (validate -> dedupe -> merge/create)
                        |
                        v
              SQLite (todos + source_events)
```

## 4. 模块设计

### 4.1 Todo Core

核心文件：`src/todo-core.ts`

职责：

- 入参标准化与 schema 校验
- dedupe key 计算
- 合并/创建事务逻辑
- 输出 `created|merged|ignored`

核心函数：

- `ingestTodo(input, actor): IngestResult`
- `computeDedupeKey(input): string`
- `buildMergePatch(existing, incoming, nowIso): TodoMergePatch`

### 4.2 Todo API

核心文件：`src/routes/todos.ts`

接口：

- `POST /api/todos/ingest`（统一写入口）
- `POST /api/todos`（手动创建，内部转 ingest）
- `GET /api/todos`（查询）
- `GET /api/todos/:id/events`（来源追溯）

### 4.3 Schema

核心文件：`src/schemas.ts`

- `TodoIngestSchema`
- `TodoQuerySchema`

### 4.4 数据层

核心文件：`src/db.ts`

- 表：`todos`
- 表：`todo_source_events`
- 函数：`getTodoByDedupeKey`、`insertTodo`、`updateTodoMerge`
- 函数：`insertTodoSourceEvent`、`listTodoSourceEvents`

### 4.5 Plugin 形态（无新增实体）

`Plugin` 在实现层直接映射为：

- `Skill Plugin`：本地技能能力包
- `MCP Plugin`：远程工具能力

管理与配置复用现有能力：

- Skills 管理：`/api/skills`
- MCP 管理：`/api/mcp-servers`
- 编排管理：`/api/workflows/templates/*`

## 5. Ingest 契约与来源约定

标准字段：

- `source_type`: `manual | workflow | automation | plugin`
- `source_id`: 来源标识
- `source_run_id`: 本次执行批次
- `trigger_mode`: `manual | automation`
- `evidence`: 证据上下文

`source_id` 约定（建议）：

- workflow: `workflow:<template_id>:<stage_id>`
- automation: `automation:<task_id>`
- plugin(skill): `skill:<skill_id>`
- plugin(mcp): `mcp:<server>:<tool>`

示例：

```http
POST /api/todos/ingest
Content-Type: application/json

{
  "title": "竞品发布了新计费页",
  "description": "检测到 pricing 页面新增 annual discount 入口",
  "priority": "high",
  "source_type": "plugin",
  "source_id": "skill:competitor-tracker",
  "source_run_id": "run_2026_03_02_0900",
  "trigger_mode": "automation",
  "dedupe_key": "competitor:pricing:annual-discount",
  "evidence": {
    "competitor": "example-ai",
    "url": "https://example.com/pricing",
    "confidence": 0.88
  }
}
```

## 6. 六类场景落地

1. 手动创建
- 链路：用户 -> `POST /api/todos`
- 来源：`source_type=manual`

2. 会话内手动执行 Workflow
- 链路：用户 -> Workflow stage -> `ingestTodo`
- 来源：`source_type=workflow`，`trigger_mode=manual`

3. 自动化定时巡检
- 链路：Automation -> Workflow(可选) -> `ingestTodo`
- 来源：`source_type=automation`，`trigger_mode=automation`

4. 失败分支写 Todo
- 链路：Workflow/Automation `on_error` -> `ingestTodo`
- 规则：失败触发必须由流程显式配置，不由 Todo Core 内部隐式触发

5. 竞品追踪插件
- 链路：Plugin(Skill/MCP) -> Workflow(可选过滤) -> `ingestTodo`
- dedupe 建议：`竞品 + 功能点 + 变更类型`

6. 项目推荐插件
- 链路：Plugin(Skill/MCP) -> Workflow(阈值过滤/打分) -> `ingestTodo`
- dedupe 建议：`推荐对象 + 推荐理由`

## 7. 与 Workflow / Automation / Plugin 集成

### 7.1 Workflow

- 在 stage 完成节点或显式步骤中调用 `todo ingest`。
- stage 传入 `source_type=workflow`。
- `trigger_mode` 由触发上下文决定（手动/自动）。

### 7.2 Automation

- 定时任务触发 Workflow 或能力步骤。
- 当配置了显式规则（如 `on_error`、`score >= threshold`）时调用 `todo ingest`。
- 不要求 Todo Core 维护自动触发策略字段。

### 7.3 Plugin（Skill/MCP）

- 插件只产出候选项，不直接写 Todo 库。
- 由 Workflow 或任务执行器将候选项映射为 ingest payload。
- 对外统一来源：`source_type=plugin`。

### 7.4 查询过滤

- `GET /api/todos?status=open&priority=high`
- `GET /api/todos?source_type=workflow&trigger_mode=manual`
- `GET /api/todos?source_type=plugin`

## 8. 治理策略

治理分层：

1. `Todo Core`
- 去重、合并、审计、并发安全

2. `Workflow/Automation`
- 触发规则（何时写入 Todo）
- 失败分支规则（`on_error`）
- 候选过滤规则（阈值、评分、白名单）

3. `Plugin (Skill/MCP)`
- 负责发现候选，不负责 Todo 治理

## 9. 测试方案

### 9.1 单元测试

- `computeDedupeKey` 稳定性
- 合并策略正确性（次数、优先级、证据）
- 幂等输入多次提交行为

### 9.2 集成测试

- `POST /api/todos/ingest` 创建路径
- 重复写入走合并路径
- 并发写入同 dedupe key 无重复记录

### 9.3 端到端测试（六类场景）

- 手动创建 Todo
- Workflow 手动触发创建 Todo
- Automation 定时触发创建 Todo
- Workflow/Automation 失败分支创建 Todo
- 竞品追踪插件创建 Todo
- 项目推荐插件创建 Todo

## 10. 分阶段实施建议

### Phase 1: Core

- 稳定 `todos` / `todo_source_events` 模型
- 稳定 `todo.ingest` 合约与事件追溯

### Phase 2: Integrations

- Workflow 全量接入统一入口
- Automation 通过显式规则接入
- Skill/MCP（插件）接入统一入口

### Phase 3: Governance & Observability

- 完善来源治理策略
- 增加创建率/合并率/噪声率指标
- 增加按来源与运行批次的审计检索

## 11. 风险与回滚

风险：

- dedupe 规则过于粗糙导致误合并
- 自动化来源误报导致 Todo 噪音

缓解：

- 对关键来源优先提供显式 `dedupe_key`
- 默认仅在显式流程规则命中时写入 Todo
- 保留 source event 全链路，支持回溯和人工修正
