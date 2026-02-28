import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getWorkflowCommandType,
  getWorkflowCommandSuggestions,
  isWorkflowCommandOnly,
  isWorkflowControlCommand,
  parseWorkflowDirectiveInput,
} from '../src/lib/workflow-directive.ts';

test('parses workflow start and control commands', () => {
  assert.equal(getWorkflowCommandType('/wf analysis-heavy'), 'start');
  assert.equal(getWorkflowCommandType('/wf analysis-heavy 请先分析'), 'start');
  assert.equal(getWorkflowCommandType('/wf-accept'), 'accept');
  assert.equal(getWorkflowCommandType('/wf-cancel'), 'cancel');
  assert.equal(getWorkflowCommandType('/wf-next'), 'next');
  assert.equal(getWorkflowCommandType('/wf-next 继续'), 'next');
  assert.equal(getWorkflowCommandType('/wf-exit'), 'exit');
  assert.equal(getWorkflowCommandType('/wf-status'), 'status');
  assert.equal(getWorkflowCommandType('/wf-next-more'), 'none');
});

test('non command content is not workflow control command', () => {
  assert.equal(getWorkflowCommandType('please help with review'), 'none');
  assert.equal(isWorkflowControlCommand('please help with review'), false);
  assert.equal(isWorkflowControlCommand('/wf review-gate'), true);
  assert.equal(isWorkflowCommandOnly('/wf review-gate'), true);
  assert.equal(isWorkflowCommandOnly('/wf review-gate 帮我先澄清'), false);
});

test('parses inline command payload', () => {
  const parsed = parseWorkflowDirectiveInput('/wf review-gate 请审查这段改动');
  assert.equal(parsed.commandType, 'start');
  assert.equal(parsed.templateId, 'review-gate');
  assert.equal(parsed.contentForPrompt, '请审查这段改动');
  assert.equal(parsed.isCommandOnly, false);
});

test('workflow command suggestions include templates and control commands', () => {
  const root = getWorkflowCommandSuggestions('/wf');
  assert.ok(root.some((item) => item.value === '/wf analysis-heavy'));
  assert.ok(root.some((item) => item.value === '/wf-status'));

  const template = getWorkflowCommandSuggestions('/wf fea');
  assert.deepEqual(template.map((item) => item.value), ['/wf feature-delivery']);

  const control = getWorkflowCommandSuggestions('/wf-ne');
  assert.deepEqual(control.map((item) => item.value), ['/wf-next']);

  const inlinePayload = getWorkflowCommandSuggestions('/wf analysis-heavy ');
  assert.deepEqual(inlinePayload, []);
});

test('workflow command suggestions include dynamic template ids', () => {
  const root = getWorkflowCommandSuggestions('/wf', {
    templates: [{
      id: 'my-custom-flow',
      name: '我的自定义流程',
      description: '用于多 agent 协作开发',
    }],
    templateIds: ['feature-delivery'],
  });
  const custom = root.find((item) => item.value === '/wf my-custom-flow');
  assert.ok(custom);
  assert.equal(custom?.description, '用于多 agent 协作开发');

  const filtered = getWorkflowCommandSuggestions('/wf my-cu', {
    templates: [{ id: 'my-custom-flow' }],
  });
  assert.deepEqual(filtered.map((item) => item.value), ['/wf my-custom-flow']);
});
