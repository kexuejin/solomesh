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
  assert.ok(dialog.includes("'/api/radar/subscriptions/settings'"));
  assert.ok(dialog.includes("'/api/radar/subscriptions/feeds'"));
  assert.ok(dialog.includes('/api/radar/subscriptions/templates/${'));
});

test('workbench tracking tab supports radar tag filters', () => {
  const page = read('web/src/pages/WorkbenchPage.tsx');
  assert.ok(page.includes("'/api/radar/subscriptions'"));
  assert.ok(page.includes('trackingTagFilter'));
  assert.ok(page.includes('trackingSourceFilter'));
  assert.ok(page.includes("t('workbench.tracking.tagsLabel')"));
  assert.ok(page.includes("t('workbench.tracking.sourceLabel')"));
  assert.ok(page.includes("t('workbench.tracking.allTags')"));
  assert.ok(page.includes("t('workbench.tracking.allSources')"));
});

test('radar subscription dialog supports custom feed tags', () => {
  const dialog = read('web/src/components/workbench/RadarSubscriptionDialog.tsx');
  assert.ok(dialog.includes('newFeedTags'));
  assert.ok(dialog.includes('parseTagInput(newFeedTags)'));
  assert.ok(dialog.includes("t('workbench.radar.feedTagsPlaceholder')"));
  assert.ok(dialog.includes('patchFeed(feed.id, { tags:'));
});

test('workbench tracking cards support source links and details panel', () => {
  const page = read('web/src/pages/WorkbenchPage.tsx');
  assert.ok(page.includes("t('workbench.actions.openSource')"));
  assert.ok(page.includes("t('workbench.actions.viewDetails')"));
  assert.ok(page.includes("t('workbench.actions.hideDetails')"));
  assert.ok(page.includes("t('workbench.card.itemUrl')"));
  assert.ok(page.includes('target="_blank"'));
});
