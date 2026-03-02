import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('workflow stage transition path ingests todo event', () => {
  const source = read('src/index.ts');
  assert.ok(source.includes('maybeAdvanceWorkflowFromAssistantReply'));
  assert.ok(source.includes('ingestTodo('));
  assert.ok(source.includes("source_type: 'workflow'"));
});
