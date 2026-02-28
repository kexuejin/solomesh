import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime env lines export runner capability hints', () => {
  const source = read('src/runtime-config.ts');

  assert.ok(source.includes('SOLOMESH_RUNTIME_LABEL='));
  assert.ok(source.includes('SOLOMESH_PRIMARY_MEMORY_FILE_NAME='));
  assert.ok(source.includes('SOLOMESH_CAP_SUPPORTS_MEMORY_FLUSH='));
  assert.ok(source.includes('SOLOMESH_CAP_SUPPORTS_NATIVE_THINKING_STREAM='));
  assert.ok(source.includes('SOLOMESH_CAP_SUPPORTS_TASK_NOTIFICATION_SYNTHESIS='));
});

test('agent runner consumes runtime capability env hints', () => {
  const runner = read('container/agent-runner/src/index.ts');

  assert.ok(runner.includes('SOLOMESH_RUNTIME_LABEL'));
  assert.ok(runner.includes('SOLOMESH_PRIMARY_MEMORY_FILE_NAME'));
  assert.ok(runner.includes('SOLOMESH_CAP_SUPPORTS_MEMORY_FLUSH'));
});

test('agent runner mcp stdio uses runtime memory file env hint', () => {
  const mcpStdio = read('container/agent-runner/src/ipc-mcp-stdio.ts');

  assert.ok(mcpStdio.includes('SOLOMESH_PRIMARY_MEMORY_FILE_NAME'));
});
