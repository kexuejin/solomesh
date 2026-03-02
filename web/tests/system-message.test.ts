import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSystemChatMessage } from '../src/lib/system-message.ts';

test('parse workflow template edit system message', () => {
  const payload = {
    templateId: 'feature-delivery',
    scope: 'user',
    status: 'draft_saved',
    summary: '新增阶段：review',
    version: 3,
    publishable: true,
  };
  const parsed = parseSystemChatMessage(
    `workflow_template_edit:${JSON.stringify(payload)}`,
  );
  assert.equal(parsed.type, 'workflow_template_edit');
  if (parsed.type !== 'workflow_template_edit') return;
  assert.equal(parsed.payload.templateId, 'feature-delivery');
  assert.equal(parsed.payload.publishable, true);
  assert.equal(parsed.payload.version, 3);
});

test('parse workflow dependency blocked system message', () => {
  const payload = {
    templateId: 'req-prototype-code_v1',
    stageId: 'prototype_design',
    stageName: '原型图生成',
    blockedReason: '渠道未配置：feishu；MCP 依赖未就绪：stitch',
    dependencies: [
      {
        type: 'channel',
        ref: 'feishu',
        reason: '渠道未配置：feishu',
        hint: '请在设置-渠道配置中启用 feishu',
        onMissing: 'guide_user',
        required: true,
      },
      {
        type: 'mcp',
        ref: 'stitch',
        reason: 'MCP 依赖未就绪：stitch',
        hint: '请确认 stitch MCP 已安装并在运行时可见',
        onMissing: 'guide_user',
        required: true,
      },
    ],
    suggestedTabs: ['my-channels', 'workflows'],
  };
  const parsed = parseSystemChatMessage(
    `workflow_dependency_blocked:${JSON.stringify(payload)}`,
  );
  assert.equal(parsed.type, 'workflow_dependency_blocked');
  if (parsed.type !== 'workflow_dependency_blocked') return;
  assert.equal(parsed.payload.templateId, 'req-prototype-code_v1');
  assert.equal(parsed.payload.dependencies.length, 2);
  assert.deepEqual(parsed.payload.suggestedTabs, ['my-channels', 'workflows']);
  assert.equal(parsed.payload.dependencies[0]?.suggestedTab, 'my-channels');
  assert.equal(parsed.payload.dependencies[1]?.suggestedTab, 'workflows');
});

test('fallback unknown system message to divider', () => {
  const parsed = parseSystemChatMessage('hello:world');
  assert.equal(parsed.type, 'divider');
  assert.equal(parsed.content, 'hello:world');
});

test('parse automation system message to divider', () => {
  const parsed = parseSystemChatMessage('automation:已创建自动化任务');
  assert.equal(parsed.type, 'divider');
  assert.equal(parsed.content, 'Automation: 已创建自动化任务');
});
