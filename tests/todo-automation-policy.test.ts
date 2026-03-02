import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPromptWithCompetitorGitCursor,
  extractCompetitorGitNextSha,
  getCompetitorGitCursorConfig,
  shouldIngestAutomationErrorTodo,
} from '../src/task-scheduler.js';

test('missing error skips automation todo ingest', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      {
        task_config: {
          on_error: { todo_ingest: true },
        },
      },
      null,
    ),
    false,
  );
});

test('error without explicit on_error.todo_ingest rule skips ingest', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      {
        task_config: {},
      },
      'task failed',
    ),
    false,
  );
});

test('error with explicit on_error.todo_ingest ingests todo', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      {
        task_config: {
          on_error: { todo_ingest: true },
        },
      },
      'task failed',
    ),
    true,
  );
});

test('competitor_git config can be read from task_config + task_state', () => {
  const config = getCompetitorGitCursorConfig({
    prompt: '请追踪竞品更新',
    task_config: {
      plugins: {
        competitor_git: {
          enabled: true,
          repo: 'https://github.com/example/competitor',
          branch: 'develop',
          lookback_commits: 120,
        },
      },
    },
    task_state: {
      plugins: {
        competitor_git: {
          last_sha: 'abc1234',
        },
      },
    },
  });

  assert.ok(config);
  assert.equal(config?.repo, 'https://github.com/example/competitor');
  assert.equal(config?.branch, 'develop');
  assert.equal(config?.lastSha, 'abc1234');
  assert.equal(config?.lookbackCommits, 120);
});

test('missing competitor_git task_config returns null', () => {
  const config = getCompetitorGitCursorConfig({
    prompt: '无配置',
    task_config: null,
    task_state: null,
  });

  assert.equal(config, null);
});

test('competitor_git config can fall back to prompt hints', () => {
  const config = getCompetitorGitCursorConfig({
    prompt: [
      'repo: https://github.com/example/competitor',
      'branch: main',
      'lookback_commits: 60',
    ].join('\n'),
    task_config: null,
    task_state: null,
  });

  assert.ok(config);
  assert.equal(config?.repo, 'https://github.com/example/competitor');
  assert.equal(config?.branch, 'main');
  assert.equal(config?.lookbackCommits, 60);
  assert.equal(config?.lastSha, null);
});

test('build prompt and parse competitor_git next sha marker', () => {
  const prompt = buildPromptWithCompetitorGitCursor('分析最近变更', {
    repo: 'https://github.com/example/competitor',
    branch: 'main',
    lastSha: 'abc1234',
    lookbackCommits: 50,
  });
  assert.ok(prompt.includes('[competitor-git-cursor]'));
  assert.ok(prompt.includes('range: abc1234..HEAD'));

  const nextSha = extractCompetitorGitNextSha(
    [
      '变化总结: xxx',
      'competitor_git_next_sha: def5678',
    ].join('\n'),
  );
  assert.equal(nextSha, 'def5678');
});
