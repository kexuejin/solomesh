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
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS radar_items'));
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS radar_user_item_state'));
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS radar_delivery_logs'));
});

test('db exports radar subscription query/update helpers', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes('export function listRadarSourceTemplates('));
  assert.ok(source.includes('export function listRadarUserSourceOverrides('));
  assert.ok(source.includes('export function createRadarUserCustomFeed('));
  assert.ok(source.includes('export function updateRadarUserSourceOverride('));
  assert.ok(source.includes('export function insertRadarItem('));
  assert.ok(source.includes('export function upsertRadarUserItemState('));
  assert.ok(source.includes('export function insertRadarDeliveryLog('));
});

test('radar template defaults are disabled and existing users are migrated to disabled subscriptions', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes("default_enabled: false"));
  assert.ok(source.includes("const SCHEMA_VERSION = '22';"));
  assert.ok(
    source.includes('clear all template-based subscriptions for existing users'),
  );
  assert.ok(
    source.includes(
      'ON CONFLICT(user_id, template_id) DO UPDATE SET\n        enabled_override = excluded.enabled_override',
    ),
  );
});
