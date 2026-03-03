import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('workflow create panel renders ai optimize action in idea input footer', () => {
  const source = read('web/src/components/settings/WorkflowSection.tsx');

  assert.ok(
    source.includes('handleOptimizeIdeaWithAi'),
    'workflow section should define idea optimization handler',
  );
  assert.ok(
    source.includes("t('settings.workflows.aiIdeaOptimize')"),
    'workflow section should render localized AI optimize label for idea input',
  );
  assert.ok(
    source.includes('justify-end'),
    'workflow idea input action should align to bottom-right area',
  );
});
