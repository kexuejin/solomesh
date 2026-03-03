import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLinkInsightAgentPrompt,
  fetchLinkInsightSnapshot,
  parseLinkInsightAgentOutput,
  parseLinkInsightChatCommandInput,
  type LinkInsightSnapshot,
} from '../src/link-insight-command.js';

test('parseLinkInsightChatCommandInput parses help command', () => {
  const parsed = parseLinkInsightChatCommandInput('/insight');
  assert.equal(parsed.hasCommand, true);
  assert.equal(parsed.isCommandOnly, true);
  assert.equal(parsed.command.type, 'help');
});

test('parseLinkInsightChatCommandInput parses analyze command with focus', () => {
  const parsed = parseLinkInsightChatCommandInput(
    '/insight https://example.com/news/abc 关注点=是否值得纳入本周待办',
  );
  assert.equal(parsed.hasCommand, true);
  assert.equal(parsed.command.type, 'analyze');
  if (parsed.command.type !== 'analyze') return;
  assert.equal(parsed.command.url, 'https://example.com/news/abc');
  assert.equal(parsed.command.focus, '关注点=是否值得纳入本周待办');
});

test('parseLinkInsightChatCommandInput keeps normal content untouched', () => {
  const parsed = parseLinkInsightChatCommandInput('这是一条普通消息');
  assert.equal(parsed.hasCommand, false);
  assert.equal(parsed.command.type, 'none');
  assert.equal(parsed.contentForPrompt, '这是一条普通消息');
});

test('buildLinkInsightAgentPrompt includes article metadata and fallback focus', () => {
  const snapshot: LinkInsightSnapshot = {
    url: 'https://example.com/blog',
    title: 'Example Blog',
    description: 'A short summary',
    content: 'Main content body',
    extractedAt: '2026-03-03T00:00:00.000Z',
  };
  const prompt = buildLinkInsightAgentPrompt(snapshot, '');
  assert.match(prompt, /文章来源：https:\/\/example\.com\/blog/);
  assert.match(prompt, /文章标题：Example Blog/);
  assert.match(prompt, /优先关注对当前项目可执行的决策与动作/);
});

test('parseLinkInsightAgentOutput parses json payload and normalizes priority', () => {
  const snapshot: LinkInsightSnapshot = {
    url: 'https://example.com/blog',
    title: 'Example Blog',
    description: 'Summary',
    content: 'Main body',
    extractedAt: '2026-03-03T00:00:00.000Z',
  };
  const output = parseLinkInsightAgentOutput(
    [
      '<link_insight_json>',
      JSON.stringify({
        decisionTitle: '结论标题',
        decisionSummary: '结论摘要',
        suggestedTodoTitle: '待办标题',
        suggestedTodoDescription: '待办描述',
        priority: 'high',
        keyPoints: ['要点1', '要点2'],
      }),
      '</link_insight_json>',
    ].join('\n'),
    snapshot,
  );

  assert.equal(output.decisionTitle, '结论标题');
  assert.equal(output.decisionSummary, '结论摘要');
  assert.equal(output.suggestedTodoTitle, '待办标题');
  assert.equal(output.suggestedTodoDescription, '待办描述');
  assert.equal(output.priority, 'high');
  assert.deepEqual(output.keyPoints, ['要点1', '要点2']);
});

test('parseLinkInsightAgentOutput falls back on invalid payload', () => {
  const snapshot: LinkInsightSnapshot = {
    url: 'https://example.com/article',
    title: 'Fallback Title',
    description: 'Fallback description',
    content: 'Fallback content',
    extractedAt: '2026-03-03T00:00:00.000Z',
  };
  const output = parseLinkInsightAgentOutput('not-json', snapshot);

  assert.match(output.decisionTitle, /^文章分析：Fallback Title/);
  assert.match(output.decisionSummary, /Fallback description/);
  assert.match(output.suggestedTodoTitle, /^评估并落地：Fallback Title/);
  assert.equal(output.priority, 'medium');
});

test('fetchLinkInsightSnapshot rejects local network hostname before fetch', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchLinkInsightSnapshot('http://127.0.0.1/internal'),
      /不允许分析本地或内网地址/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchLinkInsightSnapshot extracts visible html text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const html = [
      '<html>',
      '<head>',
      '<title>Demo</title>',
      '<meta name="description" content="Demo Desc">',
      '</head>',
      '<body>',
      '<h1>Header</h1>',
      '<script>window.secret = "x";</script>',
      '<p>Hello <b>world</b></p>',
      '</body>',
      '</html>',
    ].join('');
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;

  try {
    const snapshot = await fetchLinkInsightSnapshot('https://example.com/demo');
    assert.equal(snapshot.url, 'https://example.com/demo');
    assert.equal(snapshot.title, 'Demo');
    assert.equal(snapshot.description, 'Demo Desc');
    assert.match(snapshot.content, /Hello world/);
    assert.doesNotMatch(snapshot.content, /window\.secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
