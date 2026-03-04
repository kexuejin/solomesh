import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('workbench page exposes radar subscription entry', () => {
  const page = read('web/src/pages/WorkbenchPage.tsx');
  assert.ok(page.includes('RadarSubscriptionDialog'));
  assert.ok(page.includes("t('workbench.page.manageRadar')"));
});

test('workbench page uses tab view and defaults to tracking tab', () => {
  const page = read('web/src/pages/WorkbenchPage.tsx');
  assert.ok(page.includes('TabsTrigger'));
  assert.ok(page.includes("useState<WorkbenchTabKey>('tracking')"));
});

test('radar subscription dialog uses radar subscription APIs', () => {
  const dialog = read('web/src/components/workbench/RadarSubscriptionDialog.tsx');
  assert.ok(dialog.includes("'/api/radar/subscriptions'"));
  assert.ok(dialog.includes("'/api/radar/subscriptions/feeds'"));
  assert.ok(dialog.includes('/api/radar/subscriptions/templates/${'));
});
