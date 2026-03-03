import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('tasks route wires skill dependency precheck for create/update', () => {
  const source = read('src/routes/tasks.ts');

  assert.ok(
    source.includes('checkWorkflowSkillDependencies'),
    'tasks route should check skill dependencies',
  );
  assert.ok(
    source.includes('Task skill dependencies are not satisfied'),
    'tasks route should return explicit dependency failure',
  );
  assert.ok(
    source.includes('skillInstallOptions'),
    'tasks route should provide install package options for missing skills',
  );
  assert.ok(
    source.includes('skillInstallCandidates'),
    'tasks route should provide install candidates for missing skills',
  );
});
