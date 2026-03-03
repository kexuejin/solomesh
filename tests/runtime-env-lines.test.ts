import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('provider env line uses AGENT_RUNTIME key', () => {
  const source = read('src/runtime-config.ts');
  assert.ok(source.includes('AGENT_RUNTIME=${resolved.agentRuntime}'));
  assert.ok(
    source.includes(
      'SOLOMESH_PRIMARY_MEMORY_FILE_NAME=${sanitizeEnvValue(',
    ),
  );
  assert.ok(source.includes('SOLOMESH_CAP_SUPPORTS_MEMORY_FLUSH='));
  assert.ok(source.includes('SOLOMESH_RUNTIME_LABEL='));
});
