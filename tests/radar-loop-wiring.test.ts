import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('index starts radar automation loop', () => {
  const source = read('src/index.ts');
  assert.ok(source.includes("import { startRadarAutomationLoop } from './radar-automation.js';"));
  assert.ok(source.includes('startRadarAutomationLoop({'));
  assert.ok(source.includes('sendMessage,'));
});
