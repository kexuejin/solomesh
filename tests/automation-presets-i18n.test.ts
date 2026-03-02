import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAutomationTemplates,
  getSchedulePresets,
  parseHumanSchedule,
} from '../web/src/components/tasks/automation-presets';
import { en, zhCN } from '../web/src/i18n/messages';

function dictT(dict: typeof zhCN, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((acc, segment) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[segment] : null), dict);
  return typeof value === 'string' ? value : key;
}

test('parseHumanSchedule supports Chinese and localized labels', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');
  const parsed = parseHumanSchedule('每30分钟', now);
  assert.ok(parsed);
  assert.equal(parsed.type, 'interval');
  assert.equal(parsed.value, String(30 * 60 * 1000));
  assert.equal(parsed.label, '每 30 分钟');
});

test('parseHumanSchedule keeps existing behavior and rejects English expressions', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');
  const parsed = parseHumanSchedule('every 2 hours', now);
  assert.equal(parsed, null);
});

test('getSchedulePresets returns localized labels and hints', () => {
  const zhPresets = getSchedulePresets((key) => dictT(zhCN, key));
  const enPresets = getSchedulePresets((key) => dictT(en, key));

  assert.equal(zhPresets[0]?.label, '每 10 分钟');
  assert.equal(zhPresets[0]?.hint, '高频巡检');
  assert.equal(enPresets[0]?.label, 'Every 10 minutes');
  assert.equal(enPresets[0]?.hint, 'High-frequency checks');
});

test('getAutomationTemplates includes plugin validation presets for todo ingest', () => {
  const zhTemplates = getAutomationTemplates((key) => dictT(zhCN, key));
  const enTemplates = getAutomationTemplates((key) => dictT(en, key));

  const zhCompetitor = zhTemplates.find((item) => item.id === 'competitor-watch');
  const zhProjectRecommend = zhTemplates.find((item) => item.id === 'project-recommendation');
  const enCompetitor = enTemplates.find((item) => item.id === 'competitor-watch');
  const enProjectRecommend = enTemplates.find((item) => item.id === 'project-recommendation');

  assert.ok(zhCompetitor);
  assert.ok(zhProjectRecommend);
  assert.ok(enCompetitor);
  assert.ok(enProjectRecommend);

  assert.equal(zhCompetitor?.defaultOnErrorTodoIngest, true);
  assert.equal(zhProjectRecommend?.defaultOnErrorTodoIngest, true);
  assert.equal(enCompetitor?.defaultOnErrorTodoIngest, true);
  assert.equal(enProjectRecommend?.defaultOnErrorTodoIngest, true);
});
