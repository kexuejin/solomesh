import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('claude runner maps operationPermissionMode into SDK permission options', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('resolveOperationPermissionModeForProvider('));
  assert.ok(source.includes("containerInput.operationPermissionMode"));
  assert.ok(source.includes('permissionMode: toClaudePermissionMode(operationPermissionMode)'));
  assert.ok(source.includes("allowDangerouslySkipPermissions: operationPermissionMode === 'bypass'"));
});
