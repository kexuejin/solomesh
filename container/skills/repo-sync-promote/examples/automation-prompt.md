目标：跟踪上游仓库增量，并产出可直接 merge 到 dev 的编译通过提交序列。

参数：
- UPSTREAM_REMOTE_NAME=upstream
- UPSTREAM_REMOTE_URL=https://github.com/kexuejin/solomesh.git
- UPSTREAM_REF=upstream/main
- BASELINE_FILE=data/repo-sync-tracking/baseline.json
- FALLBACK_REF=77af4aee82cec9fbfa72e1626fc679d41f42fa23
- INTEGRATION_BASE=dev

步骤 0（必须先执行）：
- 运行：
  `node --import tsx container/skills/repo-sync-promote/scripts/repo-sync-promote.ts prepare --repo-path . --baseline-file ${BASELINE_FILE} --fallback-ref ${FALLBACK_REF} --output-dir data/repo-sync-tracking --remote-name ${UPSTREAM_REMOTE_NAME} --remote-url ${UPSTREAM_REMOTE_URL} --upstream-ref ${UPSTREAM_REF} --integration-base ${INTEGRATION_BASE}`
- 读取 `data/repo-sync-tracking/promote-plan.json`，后续分支名/worktree 路径/local_ref 都以该文件为准，不允许手写猜测。

要求：
1. 仅处理 required 改动，语义融合，不机械 cherry-pick。
2. 所有 worktree 在当前仓库 `.worktrees/` 内。
3. 每个 commit 单独通过 `make typecheck && make build`。
4. 最终执行：
   `scripts/verify-commit-build.sh --base dev --target HEAD`
5. 提交标题不要出现 upstream/integrate/merge/wip/tmp 等泛化词。
6. 不要在 commit body 添加 Co-Authored-By/Signed-off-by/Generated-by。
