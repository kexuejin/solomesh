import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('create task form renders ai optimize action for prompt input', () => {
  const source = read('web/src/components/tasks/CreateTaskForm.tsx');

  assert.ok(
    source.includes('handleOptimizePromptWithAi'),
    'create task form should define prompt optimization handler',
  );
  assert.ok(
    source.includes("t('tasks.form.aiOptimize')"),
    'create task form should render localized AI optimize label',
  );
  assert.ok(
    source.includes("'/api/workflows/templates/idea-optimize'"),
    'create task form should call idea optimize endpoint',
  );
});
