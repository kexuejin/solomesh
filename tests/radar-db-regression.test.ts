import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('db defines radar subscription tables', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS radar_source_templates'));
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS radar_user_source_overrides'));
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS radar_user_custom_feeds'));
});

test('db exports radar subscription query/update helpers', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes('export function listRadarSourceTemplates('));
  assert.ok(source.includes('export function listRadarUserSourceOverrides('));
  assert.ok(source.includes('export function createRadarUserCustomFeed('));
  assert.ok(source.includes('export function updateRadarUserSourceOverride('));
});
