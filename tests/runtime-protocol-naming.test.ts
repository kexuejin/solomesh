import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('container output markers use SOLOMESH namespace', () => {
  const hostRunner = read('src/container-runner.ts');
  const agentRunner = read('container/agent-runner/src/index.ts');

  assert.ok(hostRunner.includes('---SOLOMESH_OUTPUT_START---'));
  assert.ok(hostRunner.includes('---SOLOMESH_OUTPUT_END---'));
  assert.ok(agentRunner.includes('---SOLOMESH_OUTPUT_START---'));
  assert.ok(agentRunner.includes('---SOLOMESH_OUTPUT_END---'));
});

test('runtime env mapping uses SOLOMESH_* keys only', () => {
  const hostRunner = read('src/container-runner.ts');
  const agentRunner = read('container/agent-runner/src/index.ts');
  const mcpServer = read('container/agent-runner/src/ipc-mcp-stdio.ts');

  const hostRequiredKeys = [
    'SOLOMESH_WORKSPACE_GROUP',
    'SOLOMESH_WORKSPACE_GLOBAL',
    'SOLOMESH_WORKSPACE_MEMORY',
    'SOLOMESH_WORKSPACE_IPC',
  ];
  for (const key of hostRequiredKeys) {
    assert.ok(hostRunner.includes(key), `missing host key: ${key}`);
  }

  const runnerRequiredKeys = [
    'SOLOMESH_CHAT_JID',
    'SOLOMESH_GROUP_FOLDER',
    'SOLOMESH_IS_HOME',
    'SOLOMESH_IS_ADMIN_HOME',
    'SOLOMESH_WORKSPACE_GROUP',
    'SOLOMESH_WORKSPACE_GLOBAL',
    'SOLOMESH_WORKSPACE_MEMORY',
    'SOLOMESH_WORKSPACE_IPC',
  ];

  for (const key of runnerRequiredKeys) {
    assert.ok(agentRunner.includes(key) || mcpServer.includes(key), `missing runner key: ${key}`);
  }
});

test('MCP namespace is solomesh', () => {
  const agentRunner = read('container/agent-runner/src/index.ts');
  const mcpServer = read('container/agent-runner/src/ipc-mcp-stdio.ts');
  const host = read('src/index.ts');

  assert.ok(agentRunner.includes('mcp__solomesh__*'));
  assert.ok(mcpServer.includes("name: 'solomesh'"));
  assert.ok(host.includes("new Set<string>(['solomesh'])"));
});

test('web hash-router runtime flag uses SOLOMESH global key', () => {
  const main = read('web/src/main.tsx');
  const url = read('web/src/utils/url.ts');
  const env = read('web/src/vite-env.d.ts');

  assert.ok(main.includes('__SOLOMESH_HASH_ROUTER__'));
  assert.ok(url.includes('__SOLOMESH_HASH_ROUTER__'));
  assert.ok(env.includes('__SOLOMESH_HASH_ROUTER__'));
});
