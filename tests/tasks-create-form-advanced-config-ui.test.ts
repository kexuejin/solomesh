import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('create task form includes advanced config for permission mode and runtime', () => {
  const source = read('web/src/components/tasks/CreateTaskForm.tsx');
  assert.ok(
    source.includes("t('tasks.form.advancedTitle')"),
    'create task form should render advanced settings section',
  );
  assert.ok(
    source.includes("t('tasks.form.advancedToggleOpen')"),
    'create task form should render advanced expand toggle text',
  );
  assert.ok(
    source.includes("t('tasks.form.advancedToggleClose')"),
    'create task form should render advanced collapse toggle text',
  );
  assert.ok(
    source.includes('isAdvancedOpen && ('),
    'create task form should collapse advanced fields by default and render them conditionally',
  );
  assert.ok(
    source.includes("t('tasks.form.operationPermissionMode')"),
    'create task form should render operation permission mode selector',
  );
  assert.ok(
    source.includes("t('tasks.form.executionEnvironment')"),
    'create task form should render execution environment selector',
  );
  assert.ok(
    source.includes("t('tasks.form.agentRuntimeOverride')"),
    'create task form should render runtime override selector',
  );
});
