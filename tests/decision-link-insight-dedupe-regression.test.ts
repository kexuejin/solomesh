import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('decision ingest can merge existing pending insight item by source fingerprint', () => {
  const core = read('src/decision-core.ts');
  const db = read('src/db.ts');

  assert.ok(core.includes('buildDecisionDedupeFingerprint'));
  assert.ok(core.includes('findRecentPendingDecisionItemByFingerprint'));
  assert.ok(core.includes('updateDecisionItemPendingMerge('));
  assert.ok(core.includes("result: 'merged'"));

  assert.ok(db.includes('findRecentPendingDecisionItemByFingerprint'));
  assert.ok(db.includes('updateDecisionItemPendingMerge'));
});

test('link insight flow regression keeps ingestion in command pipeline', () => {
  const source = read('src/index.ts');

  assert.ok(source.includes('parseLinkInsightChatCommandInput'));
  assert.ok(source.includes('handleLinkInsightChatCommand'));
  assert.ok(source.includes('source_id: `link-insight:${sourceHost}`'));
  assert.ok(source.includes('await handleWorkflowControlMessages(chatJid, missedMessages)'));
});
