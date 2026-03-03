---
name: repo-sync-promote
description: 跟踪任意上游仓库的增量提交，完成“分析 → 吸收 → promote”流程，并输出可直接合并到 dev 的编译通过提交序列。
---

# Repo Sync Promote

## 适用场景

- 你的项目源自另一个上游仓库，需要持续同步能力
- 你希望“语义融合”而不是机械 cherry-pick
- 你需要每个 commit 都可独立编译通过

## 输入参数

- `UPSTREAM_REMOTE_NAME`：上游 remote 名称（例如 `upstream`）
- `UPSTREAM_REMOTE_URL`：上游仓库 URL
- `UPSTREAM_REF`：上游分支（例如 `upstream/main`）
- `BASELINE_FILE`：基线文件路径（建议 `data/repo-sync-tracking/baseline.json`）
- `FALLBACK_REF`：首次运行时的兜底本地 commit
- `INTEGRATION_BASE`：集成目标分支（通常 `dev`）

## 关键约束

- 所有 worktree 必须在当前仓库 `.worktrees/` 下
- 不允许机械“整批搬运”提交，必须按当前项目语义重落地
- 每个 commit 完成后都要过编译校验

## 标准流程

1. 先用 TS 编排脚本生成本次同步计划（推荐）

```bash
node --import tsx container/skills/repo-sync-promote/scripts/repo-sync-promote.ts prepare \
  --repo-path . \
  --baseline-file "${BASELINE_FILE}" \
  --fallback-ref "${FALLBACK_REF}" \
  --output-dir data/repo-sync-tracking \
  --remote-name "${UPSTREAM_REMOTE_NAME}" \
  --remote-url "${UPSTREAM_REMOTE_URL}" \
  --upstream-ref "${UPSTREAM_REF}" \
  --integration-base "${INTEGRATION_BASE}"
```

脚本会输出 `promote-plan.json`，包含：

2. 分支与工作区约定（由脚本给出，命名规则固定）
- 技术分支：`bot/repo-sync-<YYYYMMDD>-<upstream_head>`
- 技术 worktree：`.worktrees/repo-sync-<YYYYMMDD>-<upstream_head>`
- 集成分支：`integrate/repo-sync-<YYYYMMDD>-<upstream_head>`
- 集成 worktree：`.worktrees/integrate-repo-sync-<YYYYMMDD>-<upstream_head>`

3. 吸收 required 改动（技术分支）

- 只处理报告中的 `recommendation=required`
- 允许拆分/重组提交，但要保留 upstream -> local 映射

4. promote 到集成分支（基于 `INTEGRATION_BASE`）

- 在集成分支重新按主题落地，不直接搬运技术分支提交
- 每个提交后执行：

```bash
make typecheck
make build
```

5. 最终质量门禁

```bash
scripts/verify-commit-build.sh --base "${INTEGRATION_BASE}" --target HEAD
```

并检查：

- 无禁用词提交标题（如 `upstream/integrate/merge/wip/tmp`）
- 无尾注：`Co-Authored-By` / `Signed-off-by` / `Generated-by`

6. 人工闸门后推进基线

```bash
node --import tsx container/skills/repo-sync-promote/scripts/repo-sync-promote.ts advance-baseline \
  --repo-path . \
  --baseline-file "${BASELINE_FILE}" \
  --local-ref "<merged_upstream_head_sha>" \
  --source manual-merge
```

## 输出要求

- `local_ref`
- sync/integration 分支和 worktree 路径
- `INTEGRATION_BASE..HEAD` 提交列表
- upstream -> local 映射
- 编译门禁结果（逐 commit）
- 风险与 merge 建议
