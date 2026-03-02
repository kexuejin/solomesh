import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomationTaskSpecFromChatCommand,
  listAutomationChatTemplateIds,
  parseAutomationChatCommandInput,
} from '../src/automation-chat-command.js';

test('listAutomationChatTemplateIds exposes built-in chat automation templates', () => {
  const ids = listAutomationChatTemplateIds();
  assert.ok(ids.includes('competitor-watch'));
  assert.ok(ids.includes('project-recommendation'));
});

test('parseAutomationChatCommandInput parses help command', () => {
  const parsed = parseAutomationChatCommandInput('/auto');
  assert.equal(parsed.hasCommand, true);
  assert.equal(parsed.isCommandOnly, true);
  assert.equal(parsed.command.type, 'help');
});

test('parseAutomationChatCommandInput parses competitor create command with quoted cron', () => {
  const parsed = parseAutomationChatCommandInput(
    '/auto competitor-watch repo=https://github.com/OpenHands/OpenHands branch=main lookback=80 cron="0 9 * * 1-5" context=group',
  );
  assert.equal(parsed.command.type, 'create');
  if (parsed.command.type !== 'create') return;
  assert.equal(parsed.command.templateId, 'competitor-watch');
  assert.equal(parsed.command.args.repo, 'https://github.com/OpenHands/OpenHands');
  assert.equal(parsed.command.args.branch, 'main');
  assert.equal(parsed.command.args.lookback, '80');
  assert.equal(parsed.command.args.cron, '0 9 * * 1-5');
  assert.equal(parsed.command.args.context, 'group');
});

test('buildAutomationTaskSpecFromChatCommand builds competitor spec with repo args', () => {
  const parsed = parseAutomationChatCommandInput(
    '/auto competitor-watch repo=https://github.com/OpenHands/OpenHands branch=main lookback=80 cron="0 9 * * 1-5"',
  );
  assert.equal(parsed.command.type, 'create');
  if (parsed.command.type !== 'create') return;

  const built = buildAutomationTaskSpecFromChatCommand(parsed.command);
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.equal(built.spec.templateId, 'competitor-watch');
  assert.equal(built.spec.scheduleType, 'cron');
  assert.equal(built.spec.scheduleValue, '0 9 * * 1-5');
  assert.equal(
    (built.spec.taskConfig?.plugins as Record<string, unknown> | undefined)
      ?.competitor_git
      && typeof (built.spec.taskConfig?.plugins as Record<string, unknown>).competitor_git === 'object',
    true,
  );
  const competitorConfig = (built.spec.taskConfig?.plugins as Record<string, unknown>)
    ?.competitor_git as Record<string, unknown>;
  assert.equal(competitorConfig.repo, 'https://github.com/OpenHands/OpenHands');
  assert.equal(competitorConfig.branch, 'main');
  assert.equal(competitorConfig.lookback_commits, 80);
});

test('buildAutomationTaskSpecFromChatCommand requires repo for competitor-watch', () => {
  const parsed = parseAutomationChatCommandInput('/auto competitor-watch');
  assert.equal(parsed.command.type, 'create');
  if (parsed.command.type !== 'create') return;

  const built = buildAutomationTaskSpecFromChatCommand(parsed.command);
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.ok(built.error.includes('repo'));
});

test('buildAutomationTaskSpecFromChatCommand validates repo url format', () => {
  const parsed = parseAutomationChatCommandInput('/auto competitor-watch repo=openhands');
  assert.equal(parsed.command.type, 'create');
  if (parsed.command.type !== 'create') return;

  const built = buildAutomationTaskSpecFromChatCommand(parsed.command);
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.ok(built.error.includes('repo'));
});

test('buildAutomationTaskSpecFromChatCommand supports project-recommendation defaults', () => {
  const parsed = parseAutomationChatCommandInput('/auto project-recommendation');
  assert.equal(parsed.command.type, 'create');
  if (parsed.command.type !== 'create') return;

  const built = buildAutomationTaskSpecFromChatCommand(parsed.command);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.spec.templateId, 'project-recommendation');
  assert.equal(built.spec.scheduleType, 'cron');
  assert.equal(built.spec.scheduleValue, '30 11 * * 1-5');
  assert.equal(built.spec.contextMode, 'isolated');
  assert.equal(built.spec.taskConfig?.on_error?.todo_ingest, true);
});
