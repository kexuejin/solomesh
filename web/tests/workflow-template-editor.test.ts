import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWorkflowTemplateMarkdown,
  serializeWorkflowTemplateMarkdown,
  parseWorkflowTemplateEditorInput,
} from '../src/lib/workflow-template-editor.ts';
import type { WorkflowTemplate } from '../src/components/settings/types.ts';

const SAMPLE_TEMPLATE: WorkflowTemplate = {
  id: 'feature-delivery-v2',
  name: 'Feature Delivery V2',
  description: '功能交付模板',
  version: 2,
  recommendedTriggers: ['feature', '开发'],
  stages: [
    {
      id: 'clarify',
      name: '需求澄清',
      defaultProvider: 'claude',
      strictProvider: false,
      fallbackProviders: ['codex'],
      goal: '明确需求和验收',
      requiredOutputHints: ['目标', '范围', '验收标准'],
      doneKeywords: ['澄清完成'],
      skillRefs: ['requirements'],
      dependencies: [
        { type: 'skill', ref: 'requirements', onMissing: 'guide_user', required: true },
      ],
    },
    {
      id: 'implementation',
      name: '开发实现',
      defaultProvider: 'codex',
      strictProvider: true,
      goal: '完成代码实现与验证',
      requiredOutputHints: ['改动', '验证'],
      doneKeywords: ['实现完成'],
      skillRefs: ['coding'],
      dependencies: [
        { type: 'channel', ref: 'feishu', onMissing: 'guide_user', required: true },
        { type: 'mcp', ref: 'stitch', capability: 'prototype', onMissing: 'guide_user' },
      ],
    },
  ],
};

test('serializes and parses workflow markdown roundtrip', () => {
  const markdown = serializeWorkflowTemplateMarkdown(SAMPLE_TEMPLATE);
  const parsed = parseWorkflowTemplateMarkdown(markdown);
  assert.equal(parsed.template.id, SAMPLE_TEMPLATE.id);
  assert.equal(parsed.template.name, SAMPLE_TEMPLATE.name);
  assert.equal(parsed.template.description, SAMPLE_TEMPLATE.description);
  assert.equal(parsed.template.version, SAMPLE_TEMPLATE.version);
  assert.deepEqual(parsed.template.recommendedTriggers, SAMPLE_TEMPLATE.recommendedTriggers);
  assert.equal(parsed.template.stages.length, SAMPLE_TEMPLATE.stages.length);
  assert.equal(parsed.template.stages[0]?.defaultProvider, 'claude');
  assert.deepEqual(parsed.template.stages[0]?.fallbackProviders, ['codex']);
  assert.deepEqual(parsed.template.stages[0]?.skillRefs, ['requirements']);
  assert.deepEqual((parsed.template.stages[0] as any)?.dependencies, [
    { type: 'skill', ref: 'requirements', required: true, onMissing: 'guide_user' },
  ]);
  assert.deepEqual((parsed.template.stages[1] as any)?.dependencies, [
    { type: 'channel', ref: 'feishu', required: true, onMissing: 'guide_user' },
    { type: 'mcp', ref: 'stitch', required: true, capability: 'prototype', onMissing: 'guide_user' },
  ]);
});

test('editor input parser supports markdown mode', () => {
  const markdown = serializeWorkflowTemplateMarkdown(SAMPLE_TEMPLATE);
  const parsed = parseWorkflowTemplateEditorInput({
    mode: 'markdown',
    text: markdown,
    templateIdFallback: SAMPLE_TEMPLATE.id,
  });
  assert.equal(parsed.templateId, SAMPLE_TEMPLATE.id);
  assert.equal(parsed.payload.stages[1]?.defaultProvider, 'codex');
});

test('editor input parser supports json mode', () => {
  const parsed = parseWorkflowTemplateEditorInput({
    mode: 'json',
    text: JSON.stringify(SAMPLE_TEMPLATE),
    templateIdFallback: SAMPLE_TEMPLATE.id,
  });
  assert.equal(parsed.templateId, SAMPLE_TEMPLATE.id);
  assert.equal(parsed.payload.name, SAMPLE_TEMPLATE.name);
});
