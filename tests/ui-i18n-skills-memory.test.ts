import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/pages/SkillsPage.tsx',
  'web/src/components/skills/SkillCard.tsx',
  'web/src/components/skills/SkillDetail.tsx',
  'web/src/components/skills/InstallSkillDialog.tsx',
  'web/src/pages/MemoryPage.tsx',
] as const;

test('skills and memory module use i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});
