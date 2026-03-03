import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('create task form includes skill refs input and install-missing flow', () => {
  const source = read('web/src/components/tasks/CreateTaskForm.tsx');

  assert.ok(
    source.includes("t('tasks.form.skillRefs')"),
    'create task form should render skill refs label',
  );
  assert.ok(
    source.includes('handleInstallMissingSkillsAndRetry'),
    'create task form should support install+retry flow',
  );
  assert.ok(
    source.includes("'/api/skills/install'"),
    'create task form should call skills install endpoint',
  );
  assert.ok(
    source.includes("t('tasks.form.installMissingSkills')"),
    'create task form should render install missing skills action',
  );
});
