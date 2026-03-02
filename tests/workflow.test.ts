import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceWorkflowStage,
  archiveWorkflowTemplate,
  collectWorkflowTemplateSkillRefs,
  createWorkflowSession,
  evaluateWorkflowStageTransition,
  formatWorkflowStatusSummary,
  getWorkflowTemplate,
  getWorkflowTemplateRecord,
  getWorkflowTemplateRecordByRef,
  listWorkflowTemplateIds,
  loadWorkflowTemplateRegistry,
  parseWorkflowCommand,
  parseWorkflowCommandInput,
  parseWorkflowTemplateRegistry,
  parseWorkflowStageReport,
  parseWorkflowPendingMap,
  parseWorkflowSessionMap,
  publishWorkflowTemplateDraft,
  resolveWorkflowRecommendation,
  serializeWorkflowTemplateRegistry,
  shouldAutoAdvanceWorkflowStage,
  upsertWorkflowTemplateDraft,
} from '../src/workflow.ts';

test.beforeEach(() => {
  loadWorkflowTemplateRegistry(undefined);
});

test('parse workflow commands', () => {
  assert.deepEqual(parseWorkflowCommand('/wf analysis-heavy'), {
    type: 'start',
    templateId: 'analysis-heavy',
  });
  assert.deepEqual(parseWorkflowCommand('/wf analysis-heavy 请先梳理风险'), {
    type: 'start',
    templateId: 'analysis-heavy',
  });
  assert.deepEqual(parseWorkflowCommand('/wf-accept'), { type: 'accept' });
  assert.deepEqual(parseWorkflowCommand('/wf-next'), { type: 'next' });
  assert.deepEqual(parseWorkflowCommand('/wf-status'), { type: 'status' });
  assert.deepEqual(parseWorkflowCommand('/wf-next-more'), { type: 'none' });
  assert.deepEqual(parseWorkflowCommand('hello world'), { type: 'none' });
});

test('parse workflow command input with inline prompt', () => {
  const startInline = parseWorkflowCommandInput('/wf analysis-heavy 请先澄清需求');
  assert.equal(startInline.command.type, 'start');
  assert.equal(
    startInline.command.type === 'start' ? startInline.command.templateId : null,
    'analysis-heavy',
  );
  assert.equal(startInline.contentForPrompt, '请先澄清需求');
  assert.equal(startInline.isCommandOnly, false);

  const nextInline = parseWorkflowCommandInput('/wf-next 继续进入实现阶段');
  assert.equal(nextInline.command.type, 'next');
  assert.equal(nextInline.contentForPrompt, '继续进入实现阶段');
  assert.equal(nextInline.isCommandOnly, false);

  const commandOnly = parseWorkflowCommandInput('/wf-status');
  assert.equal(commandOnly.command.type, 'status');
  assert.equal(commandOnly.isCommandOnly, true);
});

test('workflow session and stage transition', () => {
  const template = getWorkflowTemplate('analysis-heavy');
  assert.ok(template);
  const session = createWorkflowSession('web:main', template!);
  assert.equal(session.status, 'running');
  assert.equal(session.currentStageIndex, 0);

  const moved = advanceWorkflowStage(session);
  assert.equal(moved.moved, true);
  assert.equal(moved.completed, false);
  assert.equal(moved.next.currentStageIndex, 1);
});

test('workflow can complete after last stage', () => {
  const template = getWorkflowTemplate('review-gate');
  assert.ok(template);
  let state = createWorkflowSession('web:main', template!);
  state = { ...state, currentStageIndex: template!.stages.length - 1 };
  const advanced = advanceWorkflowStage(state);
  assert.equal(advanced.completed, true);
  assert.equal(advanced.next.status, 'completed');
});

test('recommendation resolves analysis-heavy for analysis intent', () => {
  const rec = resolveWorkflowRecommendation('请帮我先调研架构风险并做分析报告');
  assert.ok(rec);
  assert.equal(rec?.templateId, 'analysis-heavy');
});

test('auto advance keyword detection follows stage config', () => {
  const template = getWorkflowTemplate('analysis-heavy');
  assert.ok(template);
  const state = createWorkflowSession('web:main', template!);
  assert.equal(shouldAutoAdvanceWorkflowStage(state, '已完成，澄清完成'), true);
  assert.equal(shouldAutoAdvanceWorkflowStage(state, '继续讨论细节'), false);
});

test('parse workflow session and pending map with sanitization', () => {
  const sessions = parseWorkflowSessionMap(JSON.stringify({
    'web:main': {
      templateId: 'analysis-heavy',
      templateVersion: 1,
      status: 'running',
      currentStageIndex: 99,
      startedAt: 'invalid',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastStageSwitchedAt: '2026-01-01T00:00:00.000Z',
    },
    foo: { templateId: 'unknown-template' },
  }));
  assert.ok(sessions['web:main']);
  assert.equal(sessions['web:main'].currentStageIndex, 5);
  assert.equal(sessions.foo, undefined);

  const pending = parseWorkflowPendingMap(JSON.stringify({
    'web:main': {
      templateId: 'analysis-heavy',
      reason: 'matched',
      suggestedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
    },
    bar: {
      templateId: 'unknown-template',
      reason: 'x',
      suggestedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
    },
  }));
  assert.ok(pending['web:main']);
  assert.equal(pending['web:main'].templateScope, 'global');
  assert.equal(pending['web:main'].templateOwnerUserId, null);
  assert.equal(pending.bar, undefined);
});

test('format workflow status summary', () => {
  const template = getWorkflowTemplate('feature-delivery');
  assert.ok(template);
  const state = createWorkflowSession('web:main', template!);
  const text = formatWorkflowStatusSummary(state);
  assert.match(text, /Feature Delivery/);
});

test('format workflow status summary includes paused blocked reason', () => {
  const template = getWorkflowTemplate('feature-delivery');
  assert.ok(template);
  const state = {
    ...createWorkflowSession('web:main', template!),
    status: 'paused' as const,
    metadata: {
      blockedReason: '缺失技能：code-review',
    },
  };
  const text = formatWorkflowStatusSummary(state);
  assert.match(text, /缺失技能：code-review/);
});

test('parse workflow stage report and strip metadata block', () => {
  const parsed = parseWorkflowStageReport(
    [
      '这是正文内容',
      '<workflow_stage_report>',
      'stage_id: clarify',
      'done: true',
      'confidence: 0.92',
      'evidence:',
      '- 已给出目标',
      '- 已给出范围',
      '</workflow_stage_report>',
    ].join('\n'),
  );
  assert.equal(parsed.cleanText, '这是正文内容');
  assert.ok(parsed.report);
  assert.equal(parsed.report?.stageId, 'clarify');
  assert.equal(parsed.report?.done, true);
  assert.equal(parsed.report?.confidence, 0.92);
  assert.deepEqual(parsed.report?.evidence, ['已给出目标', '已给出范围']);
});

test('evaluate workflow stage transition by report with backend guardrails', () => {
  const template = getWorkflowTemplate('feature-delivery');
  assert.ok(template);
  const state = createWorkflowSession('web:main', template!);
  const decision = evaluateWorkflowStageTransition(
    state,
    '目标：天气预报页面，范围：今天和未来 7 天，验收标准：可城市切换并正确展示',
    {
      stageId: 'clarify',
      done: true,
      confidence: 0.9,
      evidence: ['目标', '范围', '验收标准'],
      notes: '',
      raw: '<workflow_stage_report>...</workflow_stage_report>',
    },
  );
  assert.equal(decision.shouldAdvance, true);
  assert.equal(decision.source, 'report');
});

test('feature-delivery implementation stage defaults to codex', () => {
  const template = getWorkflowTemplate('feature-delivery');
  assert.ok(template);
  const implementationStage = template?.stages.find((stage) => stage.id === 'implementation');
  assert.ok(implementationStage);
  assert.equal(implementationStage?.defaultProvider, 'codex');
});

test('workflow template precedence: user > global > builtin', () => {
  const globalDraft = upsertWorkflowTemplateDraft({
    scope: 'global',
    template: {
      id: 'analysis-heavy',
      name: 'Global Analysis Heavy',
      description: 'global override',
      version: 1,
      stages: [
        {
          id: 'clarify',
          name: '全局澄清',
          defaultProvider: 'claude',
          goal: 'global',
          requiredOutputHints: [],
          doneKeywords: ['完成'],
        },
      ],
      recommendedTriggers: ['global'],
    },
  });
  assert.equal(globalDraft.lifecycle, 'draft');
  const globalPublished = publishWorkflowTemplateDraft({
    scope: 'global',
    templateId: 'analysis-heavy',
  });
  assert.ok(globalPublished);

  const userDraft = upsertWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u1',
    template: {
      id: 'analysis-heavy',
      name: 'User Analysis Heavy',
      description: 'user override',
      version: 1,
      stages: [
        {
          id: 'clarify',
          name: '用户澄清',
          defaultProvider: 'codex',
          goal: 'user',
          requiredOutputHints: [],
          doneKeywords: ['done'],
        },
      ],
      recommendedTriggers: ['user'],
    },
  });
  assert.equal(userDraft.lifecycle, 'draft');
  const userPublished = publishWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u1',
    templateId: 'analysis-heavy',
  });
  assert.ok(userPublished);

  const userRecord = getWorkflowTemplateRecord('analysis-heavy', { ownerUserId: 'u1' });
  assert.equal(userRecord?.scope, 'user');
  assert.equal(userRecord?.template.name, 'User Analysis Heavy');

  const otherRecord = getWorkflowTemplateRecord('analysis-heavy', { ownerUserId: 'u2' });
  assert.equal(otherRecord?.scope, 'global');
  assert.equal(otherRecord?.template.name, 'Global Analysis Heavy');

  const templateIds = listWorkflowTemplateIds({ ownerUserId: 'u1' });
  assert.ok(templateIds.includes('analysis-heavy'));
});

test('workflow template draft publish archive lifecycle', () => {
  upsertWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u1',
    template: {
      id: 'custom-flow',
      name: 'Custom Flow',
      description: '',
      version: 1,
      stages: [
        {
          id: 'step-1',
          name: 'Step 1',
          defaultProvider: 'claude',
          goal: 'Do step 1',
          requiredOutputHints: [],
          doneKeywords: ['done'],
        },
      ],
      recommendedTriggers: [],
    },
  });

  const draft = getWorkflowTemplateRecordByRef({
    scope: 'user',
    ownerUserId: 'u1',
    templateId: 'custom-flow',
    lifecycle: 'draft',
  });
  assert.ok(draft);
  assert.equal(draft?.lifecycle, 'draft');

  const published = publishWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u1',
    templateId: 'custom-flow',
  });
  assert.ok(published);
  assert.equal(published?.lifecycle, 'published');

  const draftAfterPublish = getWorkflowTemplateRecordByRef({
    scope: 'user',
    ownerUserId: 'u1',
    templateId: 'custom-flow',
    lifecycle: 'draft',
  });
  assert.equal(draftAfterPublish, null);

  const archived = archiveWorkflowTemplate({
    scope: 'user',
    ownerUserId: 'u1',
    templateId: 'custom-flow',
  });
  assert.ok(archived);
  assert.equal(archived?.lifecycle, 'archived');

  const publishedAfterArchive = getWorkflowTemplateRecordByRef({
    scope: 'user',
    ownerUserId: 'u1',
    templateId: 'custom-flow',
    lifecycle: 'published',
  });
  assert.equal(publishedAfterArchive, null);
});

test('workflow template registry serialize and parse roundtrip', () => {
  upsertWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u42',
    template: {
      id: 'serialize-test',
      name: 'Serialize Test',
      description: 'x',
      version: 1,
      stages: [
        {
          id: 'step',
          name: 'Step',
          defaultProvider: 'claude',
          goal: 'goal',
          requiredOutputHints: ['hint'],
          doneKeywords: ['done'],
        },
      ],
      recommendedTriggers: ['serialize'],
    },
  });
  publishWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u42',
    templateId: 'serialize-test',
  });

  const serialized = serializeWorkflowTemplateRegistry();
  const parsed = parseWorkflowTemplateRegistry(serialized);
  assert.ok(parsed.some((record) =>
    record.scope === 'user'
    && record.ownerUserId === 'u42'
    && record.lifecycle === 'published'
    && record.template.id === 'serialize-test',
  ));

  loadWorkflowTemplateRegistry(serialized);
  const restored = getWorkflowTemplateRecord('serialize-test', { ownerUserId: 'u42' });
  assert.ok(restored);
  assert.equal(restored?.template.name, 'Serialize Test');
});

test('collect workflow template skill refs from stages', () => {
  const refs = collectWorkflowTemplateSkillRefs({
    id: 'skill-ref-test',
    name: 'Skill Ref Test',
    description: '',
    version: 1,
    stages: [
      {
        id: 's1',
        name: 'Stage 1',
        defaultProvider: 'claude',
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [],
        skillRefs: ['lint-check', 'code-review'],
      },
      {
        id: 's2',
        name: 'Stage 2',
        defaultProvider: 'codex',
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [],
        skillRefs: ['code-review', 'fix-bugs'],
      },
    ],
    recommendedTriggers: [],
  });
  assert.deepEqual(refs, ['lint-check', 'code-review', 'fix-bugs']);
});

test('collect workflow template skill refs includes dependency skill refs', () => {
  const refs = collectWorkflowTemplateSkillRefs({
    id: 'skill-ref-dependency-test',
    name: 'Skill Ref Dependency Test',
    description: '',
    version: 1,
    stages: [
      {
        id: 's1',
        name: 'Stage 1',
        defaultProvider: 'claude',
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [],
        skillRefs: ['lint-check'],
        dependencies: [
          { type: 'skill', ref: 'code-review' },
          { type: 'skill', ref: 'lint-check' },
          { type: 'mcp', ref: 'stitch' },
        ],
      } as any,
    ],
    recommendedTriggers: [],
  } as any);
  assert.deepEqual(refs, ['lint-check', 'code-review']);
});

test('workflow stage dependencies are sanitized and preserved', () => {
  upsertWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u-deps',
    template: {
      id: 'dependency-policy-test',
      name: 'Dependency Policy Test',
      description: '',
      version: 1,
      stages: [
        {
          id: 'delivery',
          name: 'Delivery',
          defaultProvider: 'codex',
          goal: '',
          requiredOutputHints: [],
          doneKeywords: [],
          dependencies: [
            { type: 'channel', ref: 'feishu', onMissing: 'guide_user', required: true },
            { type: 'mcp', ref: 'stitch', capability: 'prototype', onMissing: 'guide_user' },
            { type: 'skill', ref: 'code-review' },
          ],
        } as any,
      ],
      recommendedTriggers: [],
    } as any,
  });
  const record = getWorkflowTemplateRecordByRef({
    scope: 'user',
    ownerUserId: 'u-deps',
    templateId: 'dependency-policy-test',
    lifecycle: 'draft',
  });
  assert.ok(record);
  const dependencies = (record?.template.stages[0] as any)?.dependencies ?? [];
  assert.equal(dependencies.length, 3);
  assert.deepEqual(dependencies[0], {
    type: 'channel',
    ref: 'feishu',
    required: true,
    onMissing: 'guide_user',
  });
  assert.deepEqual(dependencies[1], {
    type: 'mcp',
    ref: 'stitch',
    required: true,
    capability: 'prototype',
    onMissing: 'guide_user',
  });
  assert.deepEqual(dependencies[2], {
    type: 'skill',
    ref: 'code-review',
    required: true,
    onMissing: 'guide_user',
  });
});

test('workflow stage provider policy fields are preserved', () => {
  upsertWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u-provider',
    template: {
      id: 'provider-policy-test',
      name: 'Provider Policy Test',
      description: '',
      version: 1,
      stages: [
        {
          id: 'impl',
          name: 'Implementation',
          defaultProvider: 'codex',
          strictProvider: false,
          fallbackProviders: ['claude'],
          goal: '',
          requiredOutputHints: [],
          doneKeywords: [],
        },
      ],
      recommendedTriggers: [],
    },
  });
  const record = getWorkflowTemplateRecordByRef({
    scope: 'user',
    ownerUserId: 'u-provider',
    templateId: 'provider-policy-test',
    lifecycle: 'draft',
  });
  assert.ok(record);
  assert.equal(record?.template.stages[0]?.strictProvider, undefined);
  assert.deepEqual(record?.template.stages[0]?.fallbackProviders, ['claude']);
});

test('workflow stage todo ingest policy is preserved', () => {
  upsertWorkflowTemplateDraft({
    scope: 'user',
    ownerUserId: 'u-todo-ingest',
    template: {
      id: 'todo-ingest-policy-test',
      name: 'Todo Ingest Policy Test',
      description: '',
      version: 1,
      stages: [
        {
          id: 'review',
          name: 'Review',
          defaultProvider: 'codex',
          goal: '',
          requiredOutputHints: [],
          doneKeywords: [],
          todoIngest: {
            enabled: true,
            priority: 'high',
          },
        } as any,
      ],
      recommendedTriggers: [],
    } as any,
  });
  const record = getWorkflowTemplateRecordByRef({
    scope: 'user',
    ownerUserId: 'u-todo-ingest',
    templateId: 'todo-ingest-policy-test',
    lifecycle: 'draft',
  });
  assert.ok(record);
  assert.deepEqual((record?.template.stages[0] as any)?.todoIngest, {
    enabled: true,
    priority: 'high',
  });
});
