import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('index message loop pipes active messages with intent-aware send result handling', () => {
  const source = read('src/index.ts');

  assert.ok(source.includes('const intent = analyzeIntent(formatted);'));
  assert.ok(
    source.includes('const sendResult = queue.sendMessage('),
  );
  assert.ok(source.includes('{ operationPermissionMode },'));
  assert.ok(source.includes("const handledByActiveRunner = sendResult !== 'no_active';"));
});

test('web message handler uses intent-aware queue piping for active sessions', () => {
  const source = read('src/web.ts');

  assert.ok(source.includes("import { analyzeIntent } from './intent-analyzer.js';"));
  assert.ok(source.includes('const intent = analyzeIntent(formatted);'));
  assert.ok(source.includes('const sendResult = deps.queue.sendMessage('));
  assert.ok(source.includes('{ operationPermissionMode },'));
  assert.ok(source.includes("pipedToActive = sendResult !== 'no_active';"));
});
