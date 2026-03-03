import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compareRefs } from '../src/upstream-tracking.ts';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeFile(cwd: string, name: string, content: string): void {
  fs.writeFileSync(path.join(cwd, name), content, 'utf8');
}

function commitFile(cwd: string, name: string, content: string, msg: string): void {
  writeFile(cwd, name, content);
  git(cwd, ['add', name]);
  git(cwd, ['commit', '-m', msg]);
}

test('compareRefs returns ahead/behind counts for shared history refs', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'solomesh-upstream-shared-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'user.email', 'test@example.com']);

  commitFile(repo, 'README.md', 'base\n', 'base');
  git(repo, ['checkout', '-b', 'feature']);
  commitFile(repo, 'README.md', 'base\nfeature\n', 'feature');

  const result = compareRefs(repo, 'main', 'feature');
  assert.equal(result.hasSharedHistory, true);
  assert.equal(result.localOnly, 1);
  assert.equal(result.upstreamOnly, 0);
  assert.equal(result.ahead, 1);
  assert.equal(result.behind, 0);
  assert.ok(result.mergeBase);
});

test('compareRefs falls back to symmetric counts for unrelated histories', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'solomesh-upstream-unrelated-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'user.email', 'test@example.com']);

  commitFile(repo, 'a.txt', 'a1\n', 'a1');
  commitFile(repo, 'a.txt', 'a2\n', 'a2');

  git(repo, ['checkout', '--orphan', 'unrelated']);
  commitFile(repo, 'b.txt', 'b1\n', 'b1');

  const result = compareRefs(repo, 'main', 'unrelated');
  assert.equal(result.hasSharedHistory, false);
  assert.equal(result.mergeBase, null);
  assert.equal(result.upstreamOnly, 2);
  assert.equal(result.localOnly, 1);
  assert.equal(result.behind, 2);
  assert.equal(result.ahead, 1);
});
