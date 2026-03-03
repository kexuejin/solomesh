import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('project-level built-in skills exist for todo plugin scenarios', () => {
  const competitorSkill = read('container/skills/competitor-tracker/SKILL.md');
  const projectSkill = read('container/skills/project-recommender/SKILL.md');

  assert.ok(competitorSkill.includes('name: competitor-tracker'));
  assert.ok(competitorSkill.includes('todo ingest'));
  assert.ok(projectSkill.includes('name: project-recommender'));
  assert.ok(projectSkill.includes('todo ingest'));
});
