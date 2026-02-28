import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractWorkflowTemplateJsonCandidate,
  parseWorkflowTemplateEditIntent,
  summarizeWorkflowTemplateChanges,
} from '../src/workflow-template-edit.js';
import type { WorkflowTemplate } from '../src/workflow.js';

test('parse workflow template edit intent with explicit template id', () => {
  const parsed = parseWorkflowTemplateEditIntent('更新模板 feature-delivery 把实现阶段固定为 codex，并增加 review 阶段');
  assert.ok(parsed);
  assert.equal(parsed?.templateId, 'feature-delivery');
  assert.match(parsed?.goal || '', /增加 review 阶段/);
  assert.equal(parsed?.publish, false);
});

test('parse workflow template edit intent with current template and publish flag', () => {
  const parsed = parseWorkflowTemplateEditIntent('更新当前模板：把 plan 阶段拆成两个，并发布');
  assert.ok(parsed);
  assert.equal(parsed?.templateId, null);
  assert.equal(parsed?.publish, true);
});

test('parse workflow template edit intent with template id first', () => {
  const parsed = parseWorkflowTemplateEditIntent('把 feature-delivery 模板改成 implementation 使用 codex 并发布');
  assert.ok(parsed);
  assert.equal(parsed?.templateId, 'feature-delivery');
  assert.equal(parsed?.publish, true);
  assert.match(parsed?.goal || '', /implementation/);
});

test('ignore normal chat message', () => {
  const parsed = parseWorkflowTemplateEditIntent('今天帮我看下这个报错');
  assert.equal(parsed, null);
});

test('extract workflow template json candidate from xml-like block', () => {
  const json = extractWorkflowTemplateJsonCandidate(
    [
      '说明文字',
      '<workflow_template_json>',
      '{"id":"feature-delivery","name":"x","description":"","version":1,"stages":[{"id":"a","name":"A","defaultProvider":"claude","goal":"","requiredOutputHints":[],"doneKeywords":[]}],"recommendedTriggers":[]}',
      '</workflow_template_json>',
    ].join('\n'),
  );
  assert.ok(json);
  assert.equal((json as { id: string }).id, 'feature-delivery');
});

test('summarize workflow template changes', () => {
  const base: WorkflowTemplate = {
    id: 'feature-delivery',
    name: 'Feature Delivery',
    description: '',
    version: 1,
    recommendedTriggers: [],
    stages: [
      {
        id: 'plan',
        name: '计划',
        defaultProvider: 'claude',
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [],
      },
    ],
  };
  const next: WorkflowTemplate = {
    ...base,
    stages: [
      {
        id: 'plan',
        name: '计划',
        defaultProvider: 'codex',
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [],
      },
      {
        id: 'review',
        name: '审查',
        defaultProvider: 'claude',
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [],
      },
    ],
  };
  const summary = summarizeWorkflowTemplateChanges(base, next);
  assert.match(summary, /新增阶段：review/);
  assert.match(summary, /provider 变更：plan claude->codex/);
});
