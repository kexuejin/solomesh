import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('host-mode Claude wiring disables nonessential telemetry exports', () => {
  const source = read('src/container-runner.ts');

  assert.ok(source.includes("if (mergedConfig.agentRuntime === 'claude') {"));
  assert.ok(source.includes("hostEnv['DISABLE_TELEMETRY'] = '1';"));
  assert.ok(source.includes("hostEnv['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';"));
});
