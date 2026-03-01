import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/components/groups/GroupCard.tsx',
  'web/src/components/groups/GroupDetail.tsx',
] as const;

test('groups module uses i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});
